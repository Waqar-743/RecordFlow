#![allow(dead_code)]

use crate::error::RecorderError;
use crate::state::app_state::CaptureRegion;
use parking_lot::Mutex;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame as WcFrame;
use windows_capture::graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl};
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

/// Check if Windows version supports Graphics Capture API (Windows 10 1903+, build 18362+)
fn check_windows_version() -> Result<(), RecorderError> {
    match Monitor::enumerate() {
        Ok(monitors) if !monitors.is_empty() => Ok(()),
        Ok(_) => Err(RecorderError::device_not_found("No displays found")),
        Err(e) => {
            let err_str = e.to_string().to_lowercase();
            if err_str.contains("not supported")
                || err_str.contains("0x80070032")
                || err_str.contains("class not registered")
            {
                Err(RecorderError::unsupported_windows_version())
            } else {
                Err(RecorderError::device_not_found(format!(
                    "Display enumeration failed: {}",
                    e
                )))
            }
        }
    }
}

#[derive(Debug, Clone)]
pub enum CaptureTarget {
    Monitor {
        display_index: u32,
        capture_region: Option<CaptureRegion>,
    },
    Window {
        hwnd: isize,
    },
}

#[derive(Debug, Clone)]
pub struct Frame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub timestamp: u64,
    pub frame_number: u64,
}

fn clamp_region(region: Option<&CaptureRegion>, src_w: u32, src_h: u32) -> CaptureRegion {
    let Some(region) = region else {
        return CaptureRegion {
            x: 0,
            y: 0,
            width: src_w,
            height: src_h,
        };
    };

    let x = region.x.min(src_w.saturating_sub(1));
    let y = region.y.min(src_h.saturating_sub(1));
    let max_w = src_w.saturating_sub(x);
    let max_h = src_h.saturating_sub(y);

    CaptureRegion {
        x,
        y,
        width: region.width.clamp(1, max_w.max(1)),
        height: region.height.clamp(1, max_h.max(1)),
    }
}

/// Crop and scale BGRA buffer to `(dst_w, dst_h)`:
/// - Fast direct `copy_from_slice` when uncropped & 1:1
/// - Fast row-wise `copy_from_slice` when cropped at 1:1 scale
/// - Bilinear scaling (with aspect-fit letterboxing for window capture if aspect changes)
fn crop_and_scale_bgra(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    region: Option<&CaptureRegion>,
    preserve_aspect: bool,
) -> Vec<u8> {
    let crop = clamp_region(region, src_w, src_h);

    // Fast path 1: exact full-frame match
    if crop.x == 0
        && crop.y == 0
        && crop.width == src_w
        && crop.height == src_h
        && src_w == dst_w
        && src_h == dst_h
    {
        return src.to_vec();
    }

    // Fast path 2: 1:1 native-scale region crop (zero resampling overhead)
    if crop.width == dst_w && crop.height == dst_h {
        let mut out = vec![0u8; dst_w as usize * dst_h as usize * 4];
        let row_bytes = dst_w as usize * 4;
        for y in 0..dst_h {
            let src_start = (((crop.y + y) as usize) * src_w as usize + crop.x as usize) * 4;
            let dst_start = (y as usize) * row_bytes;
            out[dst_start..dst_start + row_bytes]
                .copy_from_slice(&src[src_start..src_start + row_bytes]);
        }
        return out;
    }

    // Calculate destination viewport (letterbox cleanly if window aspect ratio changed)
    let (off_x, off_y, fit_w, fit_h) = if preserve_aspect {
        let scale_x = dst_w as f64 / crop.width.max(1) as f64;
        let scale_y = dst_h as f64 / crop.height.max(1) as f64;
        let scale = scale_x.min(scale_y);
        let fw = ((crop.width as f64 * scale).round() as u32).clamp(1, dst_w);
        let fh = ((crop.height as f64 * scale).round() as u32).clamp(1, dst_h);
        ((dst_w - fw) / 2, (dst_h - fh) / 2, fw, fh)
    } else {
        (0, 0, dst_w, dst_h)
    };

    // Opaque black background (alpha = 255) for any letterbox padding
    let mut out = vec![0u8; dst_w as usize * dst_h as usize * 4];
    if fit_w < dst_w || fit_h < dst_h {
        for px in out.chunks_exact_mut(4) {
            px[3] = 255;
        }
    }

    // Fixed-point (16.16) bilinear interpolation for sharp downscaled text & fast CPU speed
    let max_sx = (crop.x + crop.width).saturating_sub(1);
    let max_sy = (crop.y + crop.height).saturating_sub(1);

    let step_x = if fit_w > 1 {
        (((crop.width.saturating_sub(1)) as u64) << 16) / (fit_w - 1) as u64
    } else {
        0
    };
    let step_y = if fit_h > 1 {
        (((crop.height.saturating_sub(1)) as u64) << 16) / (fit_h - 1) as u64
    } else {
        0
    };

    let src_stride = src_w as usize * 4;
    let dst_stride = dst_w as usize * 4;

    for dy in 0..fit_h {
        let fy = (dy as u64) * step_y;
        let sy0 = (crop.y + (fy >> 16) as u32).min(max_sy);
        let sy1 = (sy0 + 1).min(max_sy);
        let wy1 = ((fy & 0xFFFF) >> 8) as u32; // 0..255
        let wy0 = 256 - wy1;

        let row0 = sy0 as usize * src_stride;
        let row1 = sy1 as usize * src_stride;
        let dst_row = (off_y + dy) as usize * dst_stride;

        for dx in 0..fit_w {
            let fx = (dx as u64) * step_x;
            let sx0 = (crop.x + (fx >> 16) as u32).min(max_sx);
            let sx1 = (sx0 + 1).min(max_sx);
            let wx1 = ((fx & 0xFFFF) >> 8) as u32;
            let wx0 = 256 - wx1;

            let i00 = row0 + sx0 as usize * 4;
            let i10 = row0 + sx1 as usize * 4;
            let i01 = row1 + sx0 as usize * 4;
            let i11 = row1 + sx1 as usize * 4;

            let w00 = wx0 * wy0;
            let w10 = wx1 * wy0;
            let w01 = wx0 * wy1;
            let w11 = wx1 * wy1;

            let b = (src[i00] as u32 * w00
                + src[i10] as u32 * w10
                + src[i01] as u32 * w01
                + src[i11] as u32 * w11)
                >> 16;
            let g = (src[i00 + 1] as u32 * w00
                + src[i10 + 1] as u32 * w10
                + src[i01 + 1] as u32 * w01
                + src[i11 + 1] as u32 * w11)
                >> 16;
            let r = (src[i00 + 2] as u32 * w00
                + src[i10 + 2] as u32 * w10
                + src[i01 + 2] as u32 * w01
                + src[i11 + 2] as u32 * w11)
                >> 16;

            let d = dst_row + (off_x + dx) as usize * 4;
            out[d] = b as u8;
            out[d + 1] = g as u8;
            out[d + 2] = r as u8;
            out[d + 3] = 255;
        }
    }

    out
}

struct CaptureFlags {
    latest: Arc<Mutex<Option<Vec<u8>>>>,
    src_w: Arc<Mutex<u32>>,
    src_h: Arc<Mutex<u32>>,
    closed: Arc<AtomicBool>,
    target_w: u32,
    target_h: u32,
    capture_region: Option<CaptureRegion>,
    preserve_aspect: bool,
}

struct CaptureCallback {
    latest: Arc<Mutex<Option<Vec<u8>>>>,
    src_w: Arc<Mutex<u32>>,
    src_h: Arc<Mutex<u32>>,
    closed: Arc<AtomicBool>,
    target_w: u32,
    target_h: u32,
    capture_region: Option<CaptureRegion>,
    preserve_aspect: bool,
}

impl GraphicsCaptureApiHandler for CaptureCallback {
    type Flags = CaptureFlags;
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let f = ctx.flags;
        Ok(Self {
            latest: f.latest,
            src_w: f.src_w,
            src_h: f.src_h,
            closed: f.closed,
            target_w: f.target_w,
            target_h: f.target_h,
            capture_region: f.capture_region,
            preserve_aspect: f.preserve_aspect,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut WcFrame,
        _capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        let mut fb = frame.buffer()?;
        let w = fb.width();
        let h = fb.height();
        let buf = fb.as_nopadding_buffer()?;
        *self.src_w.lock() = w;
        *self.src_h.lock() = h;

        let scaled = crop_and_scale_bgra(
            buf,
            w,
            h,
            self.target_w,
            self.target_h,
            self.capture_region.as_ref(),
            self.preserve_aspect,
        );
        *self.latest.lock() = Some(scaled);
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.closed.store(true, Ordering::SeqCst);
        Ok(())
    }
}

pub struct ScreenCapturer {
    target_w: u32,
    target_h: u32,
    started_at: Instant,
    frame_number: u64,
    latest: Arc<Mutex<Option<Vec<u8>>>>,
    src_w: Arc<Mutex<u32>>,
    src_h: Arc<Mutex<u32>>,
    closed: Arc<AtomicBool>,
    control: Option<CaptureControl<CaptureCallback, Box<dyn std::error::Error + Send + Sync>>>,
}

impl ScreenCapturer {
    pub fn new(
        target: CaptureTarget,
        width: u32,
        height: u32,
        capture_cursor: bool,
    ) -> Result<Self, RecorderError> {
        if width == 0 || height == 0 {
            return Err(RecorderError::invalid_settings("Invalid target resolution"));
        }

        check_windows_version()?;

        let latest = Arc::new(Mutex::new(None));
        let src_w = Arc::new(Mutex::new(0u32));
        let src_h = Arc::new(Mutex::new(0u32));
        let closed = Arc::new(AtomicBool::new(false));

        let cursor_setting = if !GraphicsCaptureApi::is_cursor_settings_supported().unwrap_or(false)
        {
            CursorCaptureSettings::Default
        } else if capture_cursor {
            CursorCaptureSettings::WithCursor
        } else {
            CursorCaptureSettings::WithoutCursor
        };

        let border_setting = if GraphicsCaptureApi::is_border_settings_supported().unwrap_or(false)
        {
            DrawBorderSettings::WithoutBorder
        } else {
            DrawBorderSettings::Default
        };

        let control = match target {
            CaptureTarget::Monitor {
                display_index,
                capture_region,
            } => {
                let monitors = Monitor::enumerate().map_err(|e| {
                    let err_str = e.to_string().to_lowercase();
                    if err_str.contains("not supported") || err_str.contains("class not registered") {
                        RecorderError::unsupported_windows_version()
                    } else {
                        RecorderError::device_not_found(e.to_string())
                    }
                })?;
                let monitor = monitors
                    .get(display_index as usize)
                    .cloned()
                    .ok_or_else(|| RecorderError::device_not_found("Display"))?;

                let flags = CaptureFlags {
                    latest: latest.clone(),
                    src_w: src_w.clone(),
                    src_h: src_h.clone(),
                    closed: closed.clone(),
                    target_w: width,
                    target_h: height,
                    capture_region,
                    preserve_aspect: false,
                };

                let settings = Settings::new(
                    monitor,
                    cursor_setting,
                    border_setting,
                    SecondaryWindowSettings::Default,
                    MinimumUpdateIntervalSettings::Default,
                    DirtyRegionSettings::Default,
                    ColorFormat::Bgra8,
                    flags,
                );

                CaptureCallback::start_free_threaded(settings).map_err(|e| {
                    RecorderError::encoding_failed(format!("Monitor capture start failed: {e:?}"))
                })?
            }
            CaptureTarget::Window { hwnd } => {
                let window = Window::from_raw_hwnd(hwnd as *mut c_void);
                let flags = CaptureFlags {
                    latest: latest.clone(),
                    src_w: src_w.clone(),
                    src_h: src_h.clone(),
                    closed: closed.clone(),
                    target_w: width,
                    target_h: height,
                    capture_region: None,
                    preserve_aspect: true,
                };

                let settings = Settings::new(
                    window,
                    cursor_setting,
                    border_setting,
                    SecondaryWindowSettings::Default,
                    MinimumUpdateIntervalSettings::Default,
                    DirtyRegionSettings::Default,
                    ColorFormat::Bgra8,
                    flags,
                );

                CaptureCallback::start_free_threaded(settings).map_err(|e| {
                    RecorderError::encoding_failed(format!(
                        "Window capture start failed (the window may have been closed or minimized): {e:?}"
                    ))
                })?
            }
        };

        Ok(Self {
            target_w: width,
            target_h: height,
            started_at: Instant::now(),
            frame_number: 0,
            latest,
            src_w,
            src_h,
            closed,
            control: Some(control),
        })
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Relaxed)
    }

    pub fn capture_frame(&mut self) -> Result<Frame, RecorderError> {
        self.frame_number += 1;

        if self.latest.lock().is_none() {
            let deadline = Instant::now() + Duration::from_secs(2);
            while self.latest.lock().is_none() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        let data = self
            .latest
            .lock()
            .clone()
            .unwrap_or_else(|| vec![0u8; self.target_w as usize * self.target_h as usize * 4]);

        Ok(Frame {
            data,
            width: self.target_w,
            height: self.target_h,
            timestamp: self.started_at.elapsed().as_millis() as u64,
            frame_number: self.frame_number,
        })
    }

    pub fn stop(&mut self) {
        if let Some(control) = self.control.take() {
            let _ = control.stop();
        }
    }

    pub fn source_dimensions(&self) -> (u32, u32) {
        (*self.src_w.lock(), *self.src_h.lock())
    }
}
