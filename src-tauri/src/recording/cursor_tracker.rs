//! Cursor / click interaction tracking that runs alongside the recording worker.
//!
//! Samples the global cursor position and mouse button state at ~60 Hz, normalizes the
//! coordinates against the captured area and, when the recording finalizes, writes a
//! `<recording>.cursor.json` sidecar file next to the MP4.
//!
//! Tracking is strictly best-effort: any failure is logged and never fails the recording.

use crate::commands::devices::{monitor_rect, window_extended_bounds};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetSystemMetrics, SM_SWAPBUTTON};
use windows_capture::monitor::Monitor;

const SAMPLE_INTERVAL: Duration = Duration::from_micros(16_667);
const HEARTBEAT_SECONDS: f64 = 0.25;
const PAUSE_POLL: Duration = Duration::from_millis(25);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorSample {
    pub t: f64,
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorClick {
    pub t: f64,
    pub x: f32,
    pub y: f32,
    /// 0 = left, 1 = right
    pub button: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorTrack {
    pub version: u32,
    pub width: u32,
    pub height: u32,
    pub samples: Vec<CursorSample>,
    pub clicks: Vec<CursorClick>,
}

impl CursorTrack {
    /// `recording.mp4` -> `recording.cursor.json`
    pub fn sidecar_path(mp4_path: &str) -> PathBuf {
        let path = Path::new(mp4_path);
        let is_mp4 = path
            .extension()
            .map(|e| e.eq_ignore_ascii_case("mp4"))
            .unwrap_or(false);
        if is_mp4 {
            path.with_extension("cursor.json")
        } else {
            PathBuf::from(format!("{mp4_path}.cursor.json"))
        }
    }

    /// Write the sidecar JSON next to the MP4. Errors are logged, never propagated.
    pub fn write_next_to(&self, mp4_path: &str) {
        let out = Self::sidecar_path(mp4_path);
        match serde_json::to_vec(self) {
            Ok(bytes) => match std::fs::write(&out, bytes) {
                Ok(()) => eprintln!(
                    "RecordFlow: cursor track written ({} samples, {} clicks): {}",
                    self.samples.len(),
                    self.clicks.len(),
                    out.display()
                ),
                Err(e) => eprintln!(
                    "RecordFlow: failed to write cursor track {}: {e}",
                    out.display()
                ),
            },
            Err(e) => eprintln!("RecordFlow: failed to serialize cursor track: {e}"),
        }
    }
}

/// Captured area the cursor coordinates are normalized against.
#[derive(Debug, Clone, Copy)]
pub enum TrackArea {
    /// Fixed screen rectangle in virtual-desktop coordinates.
    Rect {
        left: i32,
        top: i32,
        width: u32,
        height: u32,
    },
    /// Window bounds, re-queried every sample.
    Window { hwnd: isize },
}

impl TrackArea {
    /// Full monitor rectangle for the given display index.
    pub fn for_display(display_index: u32) -> Option<Self> {
        Self::for_display_region(display_index, None)
    }

    /// Monitor rectangle offset by a region (x, y, width, height) relative to the monitor.
    pub fn for_display_region(
        display_index: u32,
        region: Option<(u32, u32, u32, u32)>,
    ) -> Option<Self> {
        let monitors = match Monitor::enumerate() {
            Ok(m) => m,
            Err(e) => {
                eprintln!("RecordFlow: cursor tracker could not enumerate monitors: {e}");
                return None;
            }
        };
        let monitor = monitors.get(display_index as usize)?;
        let rect = match monitor_rect(monitor) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("RecordFlow: cursor tracker could not resolve monitor rect: {e}");
                return None;
            }
        };
        let mon_w = (rect.right - rect.left).max(1) as u32;
        let mon_h = (rect.bottom - rect.top).max(1) as u32;
        Some(match region {
            Some((x, y, w, h)) => TrackArea::Rect {
                left: rect.left + x as i32,
                top: rect.top + y as i32,
                width: w.max(1),
                height: h.max(1),
            },
            None => TrackArea::Rect {
                left: rect.left,
                top: rect.top,
                width: mon_w,
                height: mon_h,
            },
        })
    }

    fn current_rect(&self) -> Option<(i32, i32, u32, u32)> {
        match *self {
            TrackArea::Rect {
                left,
                top,
                width,
                height,
            } => Some((left, top, width.max(1), height.max(1))),
            TrackArea::Window { hwnd } => window_extended_bounds(hwnd),
        }
    }
}

pub struct CursorTracker {
    local_stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<CursorTrack>>,
}

impl CursorTracker {
    /// Spawn the sampling thread.
    ///
    /// * `started_clock` – the recording clock origin (same as the video timeline).
    /// * `pause_flag` / `stop_flag` – the recording worker's shared flags.
    pub fn start(
        area: TrackArea,
        width: u32,
        height: u32,
        started_clock: Instant,
        pause_flag: Arc<AtomicBool>,
        stop_flag: Arc<AtomicBool>,
    ) -> Option<Self> {
        let local_stop = Arc::new(AtomicBool::new(false));
        let local_stop_thread = local_stop.clone();

        let spawn = std::thread::Builder::new()
            .name("recordflow-cursor-tracker".into())
            .spawn(move || {
                run_sampler(
                    area,
                    width,
                    height,
                    started_clock,
                    pause_flag,
                    stop_flag,
                    local_stop_thread,
                )
            });

        match spawn {
            Ok(handle) => Some(Self {
                local_stop,
                handle: Some(handle),
            }),
            Err(e) => {
                eprintln!("RecordFlow: failed to spawn cursor tracker thread: {e}");
                None
            }
        }
    }

    /// Stop sampling and return the collected track (None if the thread panicked).
    pub fn stop(mut self) -> Option<CursorTrack> {
        self.local_stop.store(true, Ordering::SeqCst);
        let handle = self.handle.take()?;
        match handle.join() {
            Ok(track) => Some(track),
            Err(_) => {
                eprintln!("RecordFlow: cursor tracker thread panicked; no cursor track saved");
                None
            }
        }
    }
}

impl Drop for CursorTracker {
    fn drop(&mut self) {
        // Ensures the sampler exits if the worker bails out early (e.g. on an error path).
        self.local_stop.store(true, Ordering::SeqCst);
    }
}

fn button_down(vk: u16) -> bool {
    // High-order bit set => key currently down.
    unsafe { (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0 }
}

fn run_sampler(
    area: TrackArea,
    width: u32,
    height: u32,
    started_clock: Instant,
    pause_flag: Arc<AtomicBool>,
    stop_flag: Arc<AtomicBool>,
    local_stop: Arc<AtomicBool>,
) -> CursorTrack {
    let mut track = CursorTrack {
        version: 1,
        width,
        height,
        samples: Vec::with_capacity(4096),
        clicks: Vec::new(),
    };

    // GetAsyncKeyState reports physical buttons; honour the "swap mouse buttons" setting.
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    let (left_vk, right_vk) = if swapped {
        (VK_RBUTTON.0, VK_LBUTTON.0)
    } else {
        (VK_LBUTTON.0, VK_RBUTTON.0)
    };

    let mut paused_total = Duration::ZERO;
    let mut pause_started: Option<Instant> = None;
    let mut last_point: Option<(i32, i32, i32, i32, u32, u32)> = None;
    let mut last_sample_t = f64::NEG_INFINITY;
    let mut last_rect: Option<(i32, i32, u32, u32)> = None;
    let mut prev_left = button_down(left_vk);
    let mut prev_right = button_down(right_vk);

    while !local_stop.load(Ordering::SeqCst) && !stop_flag.load(Ordering::SeqCst) {
        let tick = Instant::now();

        if pause_flag.load(Ordering::SeqCst) {
            if pause_started.is_none() {
                pause_started = Some(tick);
            }
            // Keep button state current so a press held across resume isn't a phantom click.
            prev_left = button_down(left_vk);
            prev_right = button_down(right_vk);
            std::thread::sleep(PAUSE_POLL);
            continue;
        }
        if let Some(p) = pause_started.take() {
            paused_total += p.elapsed();
        }

        let t = tick
            .duration_since(started_clock)
            .saturating_sub(paused_total)
            .as_secs_f64();

        let mut pt = POINT::default();
        let have_pos = unsafe { GetCursorPos(&mut pt) }.is_ok();

        if let Some(rect) = area.current_rect() {
            last_rect = Some(rect);
        }

        let left = button_down(left_vk);
        let right = button_down(right_vk);

        if let (true, Some((rl, rt, rw, rh))) = (have_pos, last_rect) {
            let x = (pt.x - rl) as f32 / rw.max(1) as f32;
            let y = (pt.y - rt) as f32 / rh.max(1) as f32;

            let mut clicked = false;
            if left && !prev_left {
                track.clicks.push(CursorClick { t, x, y, button: 0 });
                clicked = true;
            }
            if right && !prev_right {
                track.clicks.push(CursorClick { t, x, y, button: 1 });
                clicked = true;
            }

            let key = (pt.x, pt.y, rl, rt, rw, rh);
            let moved = last_point != Some(key);
            if moved || clicked || t - last_sample_t >= HEARTBEAT_SECONDS {
                track.samples.push(CursorSample { t, x, y });
                last_point = Some(key);
                last_sample_t = t;
            }
        }

        prev_left = left;
        prev_right = right;

        let spent = tick.elapsed();
        if spent < SAMPLE_INTERVAL {
            std::thread::sleep(SAMPLE_INTERVAL - spent);
        }
    }

    track
}
