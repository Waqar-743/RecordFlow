use crate::error::RecorderError;
use crate::recording::status::RecordingStatus;
use crate::recording::audio_capturer::MicrophoneCapture;
use crate::recording::camera_capturer::CameraCapturer;
use crate::recording::compositor::FrameCompositor;
use crate::recording::screen_capturer::ScreenCapturer;
use crate::recording::video_encoder::VideoEncoder;
use crate::state::app_state::AppState;
use crate::state::history::{SessionStatus, TimerSession};
use crate::utils::config::get_default_recordings_path;
use chrono::{Local, Utc};
use parking_lot::Mutex;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

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
            // Emit quickly so the UI feels responsive, while keeping work minimal.
            let tick = Duration::from_millis(250);
            loop {
                tokio::time::sleep(tick).await;

                if !*manager.state.is_recording.lock() {
                    break;
                }

                let _ = app_for_task.emit("recording_status", manager.snapshot_status());
            }
        });

        *self.tick_task.lock() = Some(handle);

        // Also emit immediately.
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

        // Prevent double-start without stopping.
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
                let (w, h) = match settings.resolution {
                    crate::state::app_state::Resolution::P720 => (1280, 720),
                    crate::state::app_state::Resolution::P1080 => (1920, 1080),
                };

                let fps = settings.fps.max(1);
                
                eprintln!("RecordFlow: Starting recording with resolution {}x{} @ {}fps", w, h, fps);
                eprintln!("RecordFlow: Output path: {}", output_path_for_thread);

                let mic = if settings.mic_enabled {
                    eprintln!("RecordFlow: Initializing microphone: {:?}", settings.microphone_device);
                    match MicrophoneCapture::new(Some(settings.microphone_device.as_str())) {
                        Ok(m) => {
                            eprintln!("RecordFlow: Microphone initialized ({}Hz, {} channels)", m.sample_rate(), m.channels());
                            Some(m)
                        },
                        Err(e) => {
                            eprintln!("RecordFlow: microphone init failed, continuing without mic: {e}");
                            None
                        }
                    }
                } else {
                    eprintln!("RecordFlow: Microphone disabled");
                    None
                };
                let audio_cfg = mic.as_ref().map(|m| (m.sample_rate(), m.channels()));

                eprintln!(
                    "RecordFlow: Initializing screen capturer for display {} with region {:?}",
                    settings.selected_display, settings.capture_region
                );
                let mut capturer = ScreenCapturer::new(settings.selected_display, w, h, settings.capture_region.clone())?;
                eprintln!("RecordFlow: Screen capturer initialized successfully");
                
                eprintln!("RecordFlow: Initializing video encoder");
                let mut encoder = VideoEncoder::new(
                    &output_path_for_thread,
                    w,
                    h,
                    fps,
                    settings.bitrate.max(1),
                    audio_cfg,
                )?;
                eprintln!("RecordFlow: Video encoder initialized successfully");

                let mut camera = if settings.camera_enabled {
                    eprintln!("RecordFlow: Initializing camera: {:?}", settings.selected_camera);
                    match CameraCapturer::new(settings.selected_camera.clone()) {
                        Ok(c) => {
                            eprintln!("RecordFlow: Camera initialized successfully");
                            Some(c)
                        },
                        Err(e) => {
                            eprintln!("RecordFlow: camera init failed, continuing without camera: {e}");
                            None
                        }
                    }
                } else {
                    eprintln!("RecordFlow: Camera disabled");
                    None
                };

                eprintln!("RecordFlow: All components initialized, starting capture loop");
                let _ = ready_tx.send(Ok(()));

                let frame_time = Duration::from_secs_f64(1.0 / fps as f64);
                let started_clock = Instant::now();
                let mut paused_total = Duration::from_secs(0);
                let mut pause_started: Option<Instant> = None;
                let mut frame_count: u64 = 0;
                
                while !stop_flag.load(Ordering::SeqCst) {
                    if pause_flag.load(Ordering::SeqCst) {
                        if pause_started.is_none() {
                            pause_started = Some(Instant::now());
                        }
                        std::thread::sleep(Duration::from_millis(25));
                        continue;
                    }

                    if let Some(p) = pause_started.take() {
                        paused_total += p.elapsed();
                    }

                    let tick = Instant::now();
                    let elapsed_recording = tick.duration_since(started_clock).saturating_sub(paused_total);
                    let mut frame = capturer.capture_frame()?;

                    if let Some(cam) = camera.as_mut() {
                        let cam_frame = cam.capture_frame()?;
                        FrameCompositor::overlay_bgra(
                            &mut frame.data,
                            frame.width,
                            frame.height,
                            &cam_frame.data,
                            cam_frame.width,
                            cam_frame.height,
                            settings.camera_position.clone(),
                            settings.camera_size.clone(),
                        )?;
                    }

                    if let Some(mic) = mic.as_ref() {
                        let sample_count = encoder
                            .audio_samples_needed_for_elapsed(elapsed_recording)
                            .unwrap_or(0);
                        let audio_pcm = mic.take_pcm_bytes_le(sample_count, settings.mic_volume);
                        encoder.encode_frame_with_audio(&frame.data, elapsed_recording, &audio_pcm)?;
                    } else {
                        encoder.encode_frame(&frame.data, elapsed_recording)?;
                    }

                    frame_count += 1;
                    // Log progress every 30 frames (once per second at 30fps)
                    if frame_count % 30 == 0 {
                        eprintln!("RecordFlow: Encoded {} frames ({:.1}s)", frame_count, elapsed_recording.as_secs_f64());
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
                eprintln!("RecordFlow: Recording completed successfully");
                Ok(())
            })();

            if let Err(e) = &run {
                let _ = ready_tx.send(Err(e.clone()));
                eprintln!("RecordFlow: recording worker failed: {e}");
                stop_flag.store(true, Ordering::SeqCst);
                *state.is_recording.lock() = false;
                *state.is_paused.lock() = false;
            }

            run
        });

        match ready_rx.recv_timeout(Duration::from_secs(3)) {
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
                // If the thread is still alive, assume it's still initializing.
                // If it's dead, it failed during initialization.
                if handle.is_finished() {
                    let res = handle.join();
                    match res {
                        Ok(Err(e)) => Err(e),
                        Ok(Ok(())) => Err(RecorderError::encoding_failed("Worker exited unexpectedly during startup")),
                        Err(_) => Err(RecorderError::encoding_failed("Worker thread panicked during startup")),
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

        // Even if the worker failed and already marked the state as stopped, we still want to
        // capture a history entry and clean up internal timers.
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
