use crate::commands::devices::window_extended_bounds;
use crate::error::RecorderError;
use crate::recording::audio_capturer::LiveAudioMixer;
use crate::recording::camera_capturer::CameraCapturer;
use crate::recording::compositor::FrameCompositor;
use crate::recording::screen_capturer::{CaptureTarget, ScreenCapturer};
use crate::recording::status::RecordingStatus;
use crate::recording::video_encoder::VideoEncoder;
use crate::state::app_state::{AppState, CaptureMode, CaptureRegion, Resolution};
use crate::state::history::{SessionStatus, TimerSession};
use crate::utils::config::get_default_recordings_path;
use chrono::{Local, Utc};
use parking_lot::Mutex;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use windows_capture::monitor::Monitor;

#[derive(Clone)]
pub struct RecordingManager {
    pub(crate) state: Arc<AppState>,
    started_at: Arc<Mutex<Option<Instant>>>,
    started_wall: Arc<Mutex<Option<chrono::DateTime<chrono::Utc>>>>,
    paused_at: Arc<Mutex<Option<Instant>>>,
    paused_total: Arc<Mutex<Duration>>,
    session_id: Arc<Mutex<Option<String>>>,
    last_session: Arc<Mutex<Option<TimerSession>>>,
    stop_flag: Arc<AtomicBool>,
    pause_flag: Arc<AtomicBool>,
    worker: Arc<Mutex<Option<JoinHandle<Result<(), RecorderError>>>>>,
    tick_task: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
}

const H264_DIMENSION_ALIGNMENT: u32 = 16;

fn aligned_dimension_inside(value: u32) -> Result<u32, RecorderError> {
    if value < H264_DIMENSION_ALIGNMENT {
        return Err(RecorderError::invalid_settings(
            "Selected recording area is too small",
        ));
    }

    let aligned = value - (value % H264_DIMENSION_ALIGNMENT);
    if aligned < H264_DIMENSION_ALIGNMENT {
        return Err(RecorderError::invalid_settings(
            "Selected recording area is too small",
        ));
    }

    Ok(aligned)
}

fn align_even_at_least(value: u32, min_val: u32) -> u32 {
    let clamped = value.max(min_val);
    clamped - (clamped % 2)
}

fn parse_window_id(id: &str) -> Option<isize> {
    id.trim().strip_prefix("window:").and_then(|s| s.parse::<isize>().ok())
}

fn normalize_capture_region_for_encoding(
    region: Option<CaptureRegion>,
) -> Result<Option<CaptureRegion>, RecorderError> {
    region
        .map(|mut capture_region| {
            capture_region.width = aligned_dimension_inside(capture_region.width)?;
            capture_region.height = aligned_dimension_inside(capture_region.height)?;
            Ok(capture_region)
        })
        .transpose()
}

fn resolve_display_native_size(display_index: u32) -> (u32, u32) {
    Monitor::enumerate()
        .ok()
        .and_then(|list| list.get(display_index as usize).cloned())
        .map(|m| (m.width().unwrap_or(1920), m.height().unwrap_or(1080)))
        .unwrap_or((1920, 1080))
}

fn fit_resolution(src_w: u32, src_h: u32, resolution: Resolution) -> (u32, u32) {
    match resolution {
        Resolution::P720 => (1280, 720),
        Resolution::P1080 => (1920, 1080),
        Resolution::Native => (
            align_even_at_least(src_w, 64),
            align_even_at_least(src_h, 64),
        ),
    }
}

fn fit_window_resolution(win_w: u32, win_h: u32, resolution: Resolution) -> (u32, u32) {
    let max_bounds = match resolution {
        Resolution::P720 => Some((1280u32, 720u32)),
        Resolution::P1080 => Some((1920u32, 1080u32)),
        Resolution::Native => None,
    };

    let (w, h) = match max_bounds {
        Some((max_w, max_h)) if win_w > max_w || win_h > max_h => {
            let scale = (max_w as f64 / win_w.max(1) as f64)
                .min(max_h as f64 / win_h.max(1) as f64);
            (
                (win_w as f64 * scale).round() as u32,
                (win_h as f64 * scale).round() as u32,
            )
        }
        _ => (win_w, win_h),
    };

    (
        align_even_at_least(w, H264_DIMENSION_ALIGNMENT),
        align_even_at_least(h, H264_DIMENSION_ALIGNMENT),
    )
}

impl RecordingManager {
    pub fn new(state: Arc<AppState>) -> Self {
        Self {
            state,
            started_at: Arc::new(Mutex::new(None)),
            started_wall: Arc::new(Mutex::new(None)),
            paused_at: Arc::new(Mutex::new(None)),
            paused_total: Arc::new(Mutex::new(Duration::from_secs(0))),
            session_id: Arc::new(Mutex::new(None)),
            last_session: Arc::new(Mutex::new(None)),
            stop_flag: Arc::new(AtomicBool::new(false)),
            pause_flag: Arc::new(AtomicBool::new(false)),
            worker: Arc::new(Mutex::new(None)),
            tick_task: Arc::new(Mutex::new(None)),
        }
    }

    pub fn snapshot_status(&self) -> RecordingStatus {
        RecordingStatus {
            is_recording: *self.state.is_recording.lock(),
            is_paused: *self.state.is_paused.lock(),
            output_file: self.state.output_file.lock().clone(),
            elapsed_seconds: self.elapsed_seconds(),
        }
    }

    pub fn start_tick_emitter(&self, app: AppHandle) {
        if let Some(handle) = self.tick_task.lock().take() {
            handle.abort();
        }

        let app_for_task = app.clone();
        let manager = self.clone();
        let handle = tauri::async_runtime::spawn(async move {
            let tick = Duration::from_millis(250);
            loop {
                tokio::time::sleep(tick).await;

                if !*manager.state.is_recording.lock() {
                    crate::tray::update_tray_indicator(&app_for_task, false, false, None);
                    let _ = app_for_task.emit("recording_status", manager.snapshot_status());
                    break;
                }

                let _ = app_for_task.emit("recording_status", manager.snapshot_status());
            }
        });

        *self.tick_task.lock() = Some(handle);
        let _ = app.emit("recording_status", self.snapshot_status());
    }

    pub fn take_last_session(&self) -> Option<TimerSession> {
        self.last_session.lock().take()
    }

    fn begin_session(&self) {
        *self.session_id.lock() = Some(Uuid::new_v4().to_string());
        *self.started_wall.lock() = Some(Utc::now());
        *self.started_at.lock() = Some(Instant::now());
        *self.paused_at.lock() = None;
        *self.paused_total.lock() = Duration::from_secs(0);
    }

    fn build_session(&self, status: SessionStatus) -> Option<TimerSession> {
        let id = self.session_id.lock().clone()?;
        let started_wall = self.started_wall.lock().as_ref()?.to_rfc3339();
        let ended = Utc::now().to_rfc3339();
        let duration_seconds = self.elapsed_seconds();
        let output_file = self.state.output_file.lock().clone();

        Some(TimerSession {
            id,
            started_at: started_wall,
            ended_at: ended,
            duration_seconds,
            status,
            output_file,
        })
    }

    fn build_output_path() -> Result<PathBuf, RecorderError> {
        let dir = get_default_recordings_path()?;
        let ts = Local::now().format("%Y%m%d_%H%M%S").to_string();
        Ok(dir.join(format!("recording_{ts}.mp4")))
    }

    pub async fn start_recording(&self) -> Result<String, RecorderError> {
        let settings = self.state.get_settings();
        if !settings.screen_enabled {
            return Err(RecorderError::invalid_settings(
                "Screen recording is disabled (camera/audio-only recording not implemented yet)",
            ));
        }

        // Reap any previously finished worker (e.g., if a captured window closed mid-recording).
        let stale_worker = {
            let mut guard = self.worker.lock();
            if guard.as_ref().is_some_and(|h| h.is_finished()) {
                guard.take()
            } else {
                None
            }
        };
        if let Some(handle) = stale_worker {
            let _ = handle.join();
        }

        if self.worker.lock().is_some() {
            return Err(RecorderError::already_recording());
        }

        let path = Self::build_output_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let output_path = path.to_string_lossy().to_string();
        let output_path_for_thread = output_path.clone();

        self.stop_flag.store(false, Ordering::SeqCst);
        self.pause_flag.store(false, Ordering::SeqCst);

        let stop_flag = self.stop_flag.clone();
        let pause_flag = self.pause_flag.clone();
        let state = self.state.clone();

        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), RecorderError>>();

        let handle = std::thread::spawn(move || -> Result<(), RecorderError> {
            let run = (|| -> Result<(), RecorderError> {
                let settings = state.get_settings();

                let (capture_target, w, h) = match settings.capture_mode {
                    CaptureMode::Window => {
                        let win_id = settings.selected_window.as_deref().ok_or_else(|| {
                            RecorderError::invalid_settings(
                                "Select a window before starting Window recording.",
                            )
                        })?;
                        let hwnd = parse_window_id(win_id).ok_or_else(|| {
                            RecorderError::invalid_settings("Invalid window selection.")
                        })?;
                        let (_, _, win_w, win_h) =
                            window_extended_bounds(hwnd).ok_or_else(|| {
                                RecorderError::device_not_found(
                                    "Selected window (it may be closed or minimized)",
                                )
                            })?;
                        let (out_w, out_h) = fit_window_resolution(win_w, win_h, settings.resolution);
                        (CaptureTarget::Window { hwnd }, out_w, out_h)
                    }
                    CaptureMode::Area => {
                        let region = normalize_capture_region_for_encoding(
                            settings.capture_region.clone(),
                        )?
                        .ok_or_else(|| {
                            RecorderError::invalid_settings(
                                "Select a capture area before starting Area recording.",
                            )
                        })?;
                        let out_w = region.width;
                        let out_h = region.height;
                        (
                            CaptureTarget::Monitor {
                                display_index: settings.selected_display,
                                capture_region: Some(region),
                            },
                            out_w,
                            out_h,
                        )
                    }
                    CaptureMode::Screen => {
                        let (native_w, native_h) =
                            resolve_display_native_size(settings.selected_display);
                        let (out_w, out_h) =
                            fit_resolution(native_w, native_h, settings.resolution);
                        (
                            CaptureTarget::Monitor {
                                display_index: settings.selected_display,
                                capture_region: None,
                            },
                            out_w,
                            out_h,
                        )
                    }
                };

                let fps = settings.fps.clamp(15, 60);
                let bitrate = settings.bitrate.clamp(1500, 30_000);

                eprintln!(
                    "RecordFlow: Starting {:?} recording {}x{} @ {}fps ({} kbps, cursor={})",
                    settings.capture_mode, w, h, fps, bitrate, settings.capture_cursor
                );
                eprintln!("RecordFlow: Output path: {}", output_path_for_thread);

                // Initialize live audio mixer (supports mic-only, system-only, or both mixed)
                let mut audio_mixer = LiveAudioMixer::new(
                    settings.mic_enabled,
                    Some(settings.microphone_device.as_str()),
                    settings.system_audio_enabled,
                    Some(settings.system_audio_device.as_str()),
                );
                let audio_cfg = audio_mixer
                    .as_ref()
                    .map(|m| (m.sample_rate(), m.channels()));

                let mut capturer =
                    ScreenCapturer::new(capture_target, w, h, settings.capture_cursor)?;
                eprintln!("RecordFlow: Screen capturer initialized successfully");

                let mut encoder = VideoEncoder::new(
                    &output_path_for_thread,
                    w,
                    h,
                    fps,
                    bitrate,
                    audio_cfg,
                )?;
                eprintln!("RecordFlow: Video encoder initialized successfully");

                let mut camera = if settings.camera_enabled {
                    match CameraCapturer::new(settings.selected_camera.clone()) {
                        Ok(c) => {
                            eprintln!("RecordFlow: Async camera initialized successfully");
                            Some(c)
                        }
                        Err(e) => {
                            eprintln!(
                                "RecordFlow: camera init failed, continuing without camera: {e}"
                            );
                            None
                        }
                    }
                } else {
                    None
                };

                eprintln!("RecordFlow: All components initialized, starting capture loop");
                let _ = ready_tx.send(Ok(()));

                let frame_time = Duration::from_secs_f64(1.0 / fps as f64);
                let started_clock = Instant::now();
                let mut paused_total = Duration::from_secs(0);
                let mut pause_started: Option<Instant> = None;
                let mut frame_count: u64 = 0;

                let mut target_closed = false;

                while !stop_flag.load(Ordering::SeqCst) {
                    if capturer.is_closed() {
                        eprintln!("RecordFlow: Capture target closed, finalizing recording cleanly");
                        target_closed = true;
                        break;
                    }

                    if pause_flag.load(Ordering::SeqCst) {
                        if pause_started.is_none() {
                            pause_started = Some(Instant::now());
                        }
                        std::thread::sleep(Duration::from_millis(25));
                        continue;
                    }

                    if let Some(p) = pause_started.take() {
                        paused_total += p.elapsed();
                        // Discard audio accumulated while paused so A/V stays synchronized.
                        if let Some(mixer) = audio_mixer.as_ref() {
                            mixer.clear_buffers();
                        }
                    }

                    let tick = Instant::now();
                    let elapsed_recording = tick
                        .duration_since(started_clock)
                        .saturating_sub(paused_total);

                    let mut frame = capturer.capture_frame()?;

                    // Non-blocking camera overlay (never throttles screen FPS)
                    let mut disable_camera = false;
                    if let Some(cam) = camera.as_ref() {
                        match cam.latest_frame() {
                            Ok(Some(cam_frame)) => {
                                if let Err(e) = FrameCompositor::overlay_bgra(
                                    &mut frame.data,
                                    frame.width,
                                    frame.height,
                                    &cam_frame.data,
                                    cam_frame.width,
                                    cam_frame.height,
                                    settings.camera_position,
                                    settings.camera_size,
                                    settings.camera_shape,
                                    settings.camera_mirror,
                                ) {
                                    eprintln!(
                                        "RecordFlow: camera overlay failed, disabling camera: {e}"
                                    );
                                    disable_camera = true;
                                }
                            }
                            Ok(None) => {
                                // Camera warming up for its first frame; keep encoding screen smoothly.
                            }
                            Err(e) => {
                                eprintln!("RecordFlow: camera stream error, disabling camera: {e}");
                                disable_camera = true;
                            }
                        }
                    }
                    if disable_camera {
                        if let Some(cam) = camera.as_mut() {
                            cam.stop();
                        }
                        camera = None;
                    }

                    if let Some(mixer) = audio_mixer.as_mut() {
                        let sample_count = encoder
                            .audio_samples_needed_for_elapsed(elapsed_recording)
                            .unwrap_or(0);
                        let audio_pcm = mixer.take_mixed_pcm_bytes_le(
                            sample_count,
                            settings.mic_volume,
                            settings.system_audio_volume,
                        );
                        encoder.encode_frame_with_audio(
                            &frame.data,
                            elapsed_recording,
                            &audio_pcm,
                        )?;
                    } else {
                        encoder.encode_frame(&frame.data, elapsed_recording)?;
                    }

                    frame_count += 1;
                    if frame_count % (fps as u64) == 0 {
                        eprintln!(
                            "RecordFlow: Encoded {} frames ({:.1}s)",
                            frame_count,
                            elapsed_recording.as_secs_f64()
                        );
                    }

                    let elapsed = tick.elapsed();
                    if elapsed < frame_time {
                        std::thread::sleep(frame_time - elapsed);
                    }
                }

                eprintln!("RecordFlow: Stopping capture, encoded {} total frames", frame_count);
                capturer.stop();
                if let Some(cam) = camera.as_mut() {
                    cam.stop();
                }
                eprintln!("RecordFlow: Finalizing video encoder...");
                encoder.finalize()?;
                if target_closed {
                    crate::recording::frame_overlay::hide_recording_frame();
                    stop_flag.store(true, Ordering::SeqCst);
                    *state.is_recording.lock() = false;
                    *state.is_paused.lock() = false;
                }
                eprintln!("RecordFlow: Recording completed successfully");
                Ok(())
            })();

            if let Err(e) = &run {
                let _ = ready_tx.send(Err(e.clone()));
                eprintln!("RecordFlow: recording worker failed: {e}");
                crate::recording::frame_overlay::hide_recording_frame();
                stop_flag.store(true, Ordering::SeqCst);
                *state.is_recording.lock() = false;
                *state.is_paused.lock() = false;
            }

            run
        });

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {
                self.state.start_recording(output_path.clone())?;
                self.begin_session();
                *self.worker.lock() = Some(handle);
                Ok(output_path)
            }
            Ok(Err(e)) => {
                self.stop_flag.store(true, Ordering::SeqCst);
                let _ = handle.join();
                Err(e)
            }
            Err(_) => {
                if handle.is_finished() {
                    let res = handle.join();
                    match res {
                        Ok(Err(e)) => Err(e),
                        Ok(Ok(())) => Err(RecorderError::encoding_failed(
                            "Worker exited unexpectedly during startup",
                        )),
                        Err(_) => Err(RecorderError::encoding_failed(
                            "Worker thread panicked during startup",
                        )),
                    }
                } else {
                    self.state.start_recording(output_path.clone())?;
                    self.begin_session();
                    *self.worker.lock() = Some(handle);
                    Ok(output_path)
                }
            }
        }
    }

    pub async fn stop_recording(&self) -> Result<String, RecorderError> {
        self.stop_flag.store(true, Ordering::SeqCst);
        self.pause_flag.store(false, Ordering::SeqCst);

        let mut worker_error: Option<RecorderError> = None;

        if let Some(handle) = self.worker.lock().take() {
            match handle.join() {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    worker_error = Some(e);
                }
                Err(_) => {
                    worker_error = Some(RecorderError::encoding_failed("Recording thread panicked"));
                }
            }
        }

        let status = if worker_error.is_some() {
            SessionStatus::Failed
        } else {
            SessionStatus::Completed
        };
        let session = self.build_session(status);
        *self.last_session.lock() = session;

        if *self.state.is_recording.lock() {
            self.state.stop_recording()?;
        }

        *self.started_at.lock() = None;
        *self.started_wall.lock() = None;
        *self.session_id.lock() = None;
        *self.paused_at.lock() = None;
        *self.paused_total.lock() = Duration::from_secs(0);

        if let Some(err) = worker_error {
            return Err(err);
        }

        Ok(self.state.output_file.lock().clone().unwrap_or_default())
    }

    pub async fn pause_recording(&self) -> Result<String, RecorderError> {
        self.state.pause_recording()?;
        self.pause_flag.store(true, Ordering::SeqCst);
        *self.paused_at.lock() = Some(Instant::now());
        Ok("paused".to_string())
    }

    pub async fn resume_recording(&self) -> Result<String, RecorderError> {
        self.state.resume_recording()?;
        self.pause_flag.store(false, Ordering::SeqCst);
        if let Some(paused_at) = self.paused_at.lock().take() {
            let paused = paused_at.elapsed();
            *self.paused_total.lock() += paused;
        }
        Ok("resumed".to_string())
    }

    pub fn elapsed_seconds(&self) -> u64 {
        let started_at = match *self.started_at.lock() {
            Some(t) => t,
            None => return 0,
        };

        let paused_at = self.paused_at.lock().clone();
        let now = paused_at.unwrap_or_else(Instant::now);
        let total = now.duration_since(started_at);
        let paused_total = *self.paused_total.lock();
        total
            .checked_sub(paused_total)
            .unwrap_or_else(|| Duration::from_secs(0))
            .as_secs()
    }
}
