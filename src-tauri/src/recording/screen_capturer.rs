#![allow(dead_code)]

use crate::error::RecorderError;
use crate::state::app_state::CaptureRegion;
use parking_lot::Mutex;
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame as WcFrame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};

/// Check if Windows version supports Graphics Capture API (Windows 10 1903+, build 18362+)
fn check_windows_version() -> Result<(), RecorderError> {
    // The Graphics Capture API requires Windows 10 version 1903 (build 18362) or later
    // We'll try to enumerate monitors - if it fails, the API is not available
    match Monitor::enumerate() {
        Ok(monitors) if !monitors.is_empty() => Ok(()),
        Ok(_) => Err(RecorderError::device_not_found("No displays found")),
        Err(e) => {
            let err_str = e.to_string().to_lowercase();
            // Check if the error indicates unsupported Windows version
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

fn crop_and_scale_bgra_nearest(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    region: Option<&CaptureRegion>,
) -> Vec<u8> {
    let crop = clamp_region(region, src_w, src_h);

    if crop.x == 0
        && crop.y == 0
        && crop.width == src_w
        && crop.height == src_h
        && src_w == dst_w
        && src_h == dst_h
    {
        return src.to_vec();
    }

    let mut out = vec![0u8; dst_w as usize * dst_h as usize * 4];
    for y in 0..dst_h {
        let sy = crop.y + (y as u64 * crop.height as u64 / dst_h as u64) as u32;
        for x in 0..dst_w {
            let sx = crop.x + (x as u64 * crop.width as u64 / dst_w as u64) as u32;

            let s = ((sy as usize * src_w as usize + sx as usize) * 4) as usize;
            let d = ((y as usize * dst_w as usize + x as usize) * 4) as usize;
            out[d..d + 4].copy_from_slice(&src[s..s + 4]);
        }
    }
    out
}

struct CaptureCallback {
    latest: Arc<Mutex<Option<Vec<u8>>>>,
    src_w: Arc<Mutex<u32>>,
    src_h: Arc<Mutex<u32>>,
    target_w: u32,
    target_h: u32,
    capture_region: Option<CaptureRegion>,
}

impl GraphicsCaptureApiHandler for CaptureCallback {
    type Flags = (
        Arc<Mutex<Option<Vec<u8>>>>,
        Arc<Mutex<u32>>,
        Arc<Mutex<u32>>,
        u32,
        u32,
        Option<CaptureRegion>,
    );
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let (latest, src_w, src_h, target_w, target_h, capture_region) = ctx.flags;
        Ok(Self {
            latest,
            src_w,
            src_h,
            target_w,
            target_h,
            capture_region,
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

        let scaled = crop_and_scale_bgra_nearest(
            buf,
            w,
            h,
            self.target_w,
            self.target_h,
            self.capture_region.as_ref(),
        );
        *self.latest.lock() = Some(scaled);
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
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
    control: Option<CaptureControl<CaptureCallback, Box<dyn std::error::Error + Send + Sync>>>,
}

impl ScreenCapturer {
    pub fn new(
        display_index: u32,
        width: u32,
        height: u32,
        capture_region: Option<CaptureRegion>,
    ) -> Result<Self, RecorderError> {
        if width == 0 || height == 0 {
            return Err(RecorderError::invalid_settings("Invalid target resolution"));
        }

        // Check Windows version compatibility first
        check_windows_version()?;

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

        let latest = Arc::new(Mutex::new(None));
        let src_w = Arc::new(Mutex::new(0u32));
        let src_h = Arc::new(Mutex::new(0u32));

        let settings = Settings::new(
            monitor,
            CursorCaptureSettings::Default,
            DrawBorderSettings::WithoutBorder,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            (
                latest.clone(),
                src_w.clone(),
                src_h.clone(),
                width,
                height,
                capture_region,
            ),
        );

        let control = CaptureCallback::start_free_threaded(settings).map_err(|e| {
            RecorderError::encoding_failed(format!("Screen capture start failed: {e:?}"))
        })?;

        Ok(Self {
            target_w: width,
            target_h: height,
            started_at: Instant::now(),
            frame_number: 0,
            latest,
            src_w,
            src_h,
            control: Some(control),
        })
    }

    pub fn capture_frame(&mut self) -> Result<Frame, RecorderError> {
        self.frame_number += 1;

        // Wait briefly for first frame.
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
