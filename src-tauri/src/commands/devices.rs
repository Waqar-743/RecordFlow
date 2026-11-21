use crate::error::RecorderError;
use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    GetMonitorInfoW, ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HMONITOR, MONITORINFOEXW, SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, IsIconic, IsWindow, PW_RENDERFULLCONTENT,
};
use windows_capture::monitor::Monitor;
use windows_capture::window::Window;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub index: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: String,
    pub title: String,
    pub process: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraInfo {
    pub index: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub index: u32,
    pub name: String,
    pub channels: u16,
    pub sample_rate: u32,
    pub is_input: bool,
}

pub fn monitor_rect(monitor: &Monitor) -> Result<RECT, RecorderError> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

    unsafe {
        let hmonitor = HMONITOR(monitor.as_raw_hmonitor() as *mut c_void);
        let ok = GetMonitorInfoW(hmonitor, &mut info as *mut MONITORINFOEXW as *mut _).as_bool();
        if !ok {
            return Err(RecorderError::file_error(format!(
                "GetMonitorInfoW failed: {}",
                windows::core::Error::from_win32()
            )));
        }
    }

    Ok(info.monitorInfo.rcMonitor)
}

pub fn window_extended_bounds(hwnd: isize) -> Option<(i32, i32, u32, u32)> {
    let mut rect = RECT::default();
    let res = unsafe {
        DwmGetWindowAttribute(
            HWND(hwnd as *mut c_void),
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        )
    };
    if res.is_err() || rect.right <= rect.left || rect.bottom <= rect.top {
        return None;
    }
    Some((
        rect.left,
        rect.top,
        (rect.right - rect.left) as u32,
        (rect.bottom - rect.top) as u32,
    ))
}

/// List connected monitors.
#[tauri::command]
pub async fn get_displays() -> Result<Vec<DisplayInfo>, RecorderError> {
    let monitors = Monitor::enumerate().map_err(|e| {
        let err_str = e.to_string().to_lowercase();
        if err_str.contains("not supported")
            || err_str.contains("class not registered")
            || err_str.contains("0x80070032")
        {
            RecorderError::new(
                "UNSUPPORTED_WINDOWS_VERSION",
                "Screen capture requires Windows 10 version 1903 or later.",
                Some("Please update Windows to use screen recording features.".to_string()),
            )
        } else {
            RecorderError::file_error(e.to_string())
        }
    })?;
    if monitors.is_empty() {
        return Err(RecorderError::device_not_found("Display"));
    }

    let primary = Monitor::primary().ok();
    let mut displays = Vec::with_capacity(monitors.len());

    for (i, m) in monitors.iter().enumerate() {
        let width = m.width().unwrap_or(0);
        let height = m.height().unwrap_or(0);
        let rect = monitor_rect(m).unwrap_or(RECT {
            left: 0,
            top: 0,
            right: width as i32,
            bottom: height as i32,
        });
        let is_primary = primary
            .as_ref()
            .and_then(|p| p.device_name().ok())
            .and_then(|p_name| m.device_name().ok().map(|n| n == p_name))
            .unwrap_or(false);

        let mut name = m.name().unwrap_or_else(|_| format!("Display {}", i + 1));
        if is_primary && !name.contains("Primary") {
            name = format!("{} (Primary)", name);
        }

        displays.push(DisplayInfo {
            index: i as u32,
            name,
            width,
            height,
            x: rect.left,
            y: rect.top,
            is_primary,
        });
    }

    Ok(displays)
}

fn clamp_thumbnail_width(max_width: Option<u32>) -> u32 {
    max_width.unwrap_or(640).clamp(160, 1920)
}

/// Capture a screen rectangle (virtual-desktop coordinates) via GDI StretchBlt and
/// return it as a PNG scaled down to at most `max_width` pixels wide.
fn capture_screen_rect_png(
    left: i32,
    top: i32,
    src_w: u32,
    src_h: u32,
    max_width: u32,
) -> Result<Vec<u8>, RecorderError> {
    let src_w = src_w.max(1);
    let src_h = src_h.max(1);
    let max_width = max_width.max(2);
    let scale = (max_width as f64 / src_w as f64).min(1.0);
    let dst_w = ((src_w as f64 * scale).round() as u32).max(2);
    let dst_h = ((src_h as f64 * scale).round() as u32).max(2);

    let mut pixels = vec![0u8; (dst_w * dst_h * 4) as usize];

    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err(RecorderError::file_error("Could not acquire screen DC"));
        }
        let mem = CreateCompatibleDC(Some(screen));
        if mem.is_invalid() {
            let _ = ReleaseDC(None, screen);
            return Err(RecorderError::file_error("Could not create compatible DC"));
        }
        let bitmap = CreateCompatibleBitmap(screen, dst_w as i32, dst_h as i32);
        if bitmap.is_invalid() {
            let _ = DeleteDC(mem);
            let _ = ReleaseDC(None, screen);
            return Err(RecorderError::file_error("Could not create thumbnail bitmap"));
        }
        let prev = SelectObject(mem, bitmap.into());
        SetStretchBltMode(mem, HALFTONE);
        let copied = StretchBlt(
            mem,
            0,
            0,
            dst_w as i32,
            dst_h as i32,
            Some(screen),
            left,
            top,
            src_w as i32,
            src_h as i32,
            SRCCOPY,
        )
        .as_bool();

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: dst_w as i32,
                biHeight: -(dst_h as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let rows = GetDIBits(
            mem,
            bitmap,
            0,
            dst_h,
            Some(pixels.as_mut_ptr() as *mut c_void),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(mem, prev);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem);
        let _ = ReleaseDC(None, screen);

        if !copied || rows == 0 {
            return Err(RecorderError::file_error(
                "Failed to capture screen thumbnail",
            ));
        }
    }

    // BGRA -> RGBA opaque
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
        px[3] = 255;
    }

    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, dst_w, dst_h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| RecorderError::file_error(format!("PNG header error: {e}")))?;
        writer
            .write_image_data(&pixels)
            .map_err(|e| RecorderError::file_error(format!("PNG encode error: {e}")))?;
    }

    Ok(png_bytes)
}

/// Capture a fast scaled PNG thumbnail of the selected display via GDI StretchBlt.
#[tauri::command]
pub async fn get_display_thumbnail(
    display_index: u32,
    max_width: Option<u32>,
) -> Result<Vec<u8>, RecorderError> {
    let monitors = Monitor::enumerate().map_err(|e| RecorderError::file_error(e.to_string()))?;
    let monitor = monitors
        .get(display_index as usize)
        .ok_or_else(|| RecorderError::device_not_found("Display"))?;

    let rect = monitor_rect(monitor)?;
    let src_w = (rect.right - rect.left).max(1) as u32;
    let src_h = (rect.bottom - rect.top).max(1) as u32;

    capture_screen_rect_png(
        rect.left,
        rect.top,
        src_w,
        src_h,
        clamp_thumbnail_width(max_width),
    )
}

/// Capture a single application window directly via `PrintWindow(PW_RENDERFULLCONTENT)`
/// so the thumbnail reflects the selected window's own content even when occluded by
/// RecordFlow or other windows.
fn capture_window_png(hwnd: isize, max_width: u32) -> Result<Vec<u8>, RecorderError> {
    let hwnd_handle = HWND(hwnd as *mut c_void);

    unsafe {
        if !IsWindow(Some(hwnd_handle)).as_bool() {
            return Err(RecorderError::device_not_found("Window is no longer open"));
        }
        if IsIconic(hwnd_handle).as_bool() {
            return Err(RecorderError::invalid_settings(
                "Window is minimized; restore it to show a preview",
            ));
        }
    }

    let mut win_rect = RECT::default();
    unsafe {
        GetWindowRect(hwnd_handle, &mut win_rect).map_err(|_| {
            RecorderError::device_not_found("Window bounds (it may be closed or hidden)")
        })?;
    }

    let win_w = (win_rect.right - win_rect.left).max(0) as u32;
    let win_h = (win_rect.bottom - win_rect.top).max(0) as u32;
    if win_w < 2 || win_h < 2 {
        return Err(RecorderError::device_not_found(
            "Window has empty dimensions",
        ));
    }

    // Crop out invisible Windows 10/11 DWM drop-shadow borders when extended bounds are available.
    let (crop_x, crop_y, crop_w, crop_h) = match window_extended_bounds(hwnd) {
        Some((ext_left, ext_top, ext_w, ext_h)) => {
            let cx = (ext_left - win_rect.left).clamp(0, (win_w as i32).saturating_sub(1));
            let cy = (ext_top - win_rect.top).clamp(0, (win_h as i32).saturating_sub(1));
            let cw = (ext_w as i32).min(win_w as i32 - cx).max(1) as u32;
            let ch = (ext_h as i32).min(win_h as i32 - cy).max(1) as u32;
            (cx, cy, cw, ch)
        }
        None => (0, 0, win_w, win_h),
    };

    let max_width = max_width.max(2);
    let scale = (max_width as f64 / crop_w as f64).min(1.0);
    let dst_w = ((crop_w as f64 * scale).round() as u32).max(2);
    let dst_h = ((crop_h as f64 * scale).round() as u32).max(2);

    let mut pixels = vec![0u8; (dst_w * dst_h * 4) as usize];

    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err(RecorderError::file_error("Could not acquire screen DC"));
        }

        let full_dc = CreateCompatibleDC(Some(screen));
        if full_dc.is_invalid() {
            let _ = ReleaseDC(None, screen);
            return Err(RecorderError::file_error("Could not create window DC"));
        }

        let full_bitmap = CreateCompatibleBitmap(screen, win_w as i32, win_h as i32);
        if full_bitmap.is_invalid() {
            let _ = DeleteDC(full_dc);
            let _ = ReleaseDC(None, screen);
            return Err(RecorderError::file_error("Could not create window bitmap"));
        }

        let prev_full = SelectObject(full_dc, full_bitmap.into());

        // PW_RENDERFULLCONTENT renders DWM/DirectComposition/Chromium/Electron windows
        // even when covered by RecordFlow or other windows.
        let mut printed =
            PrintWindow(hwnd_handle, full_dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();
        if !printed {
            printed = PrintWindow(hwnd_handle, full_dc, PRINT_WINDOW_FLAGS(0)).as_bool();
        }

        let mut copied = false;
        let mut rows = 0;

        if printed {
            let dst_dc = CreateCompatibleDC(Some(screen));
            if !dst_dc.is_invalid() {
                let dst_bitmap = CreateCompatibleBitmap(screen, dst_w as i32, dst_h as i32);
                if !dst_bitmap.is_invalid() {
                    let prev_dst = SelectObject(dst_dc, dst_bitmap.into());
                    SetStretchBltMode(dst_dc, HALFTONE);
                    copied = StretchBlt(
                        dst_dc,
                        0,
                        0,
                        dst_w as i32,
                        dst_h as i32,
                        Some(full_dc),
                        crop_x,
                        crop_y,
                        crop_w as i32,
                        crop_h as i32,
                        SRCCOPY,
                    )
                    .as_bool();

                    if copied {
                        let mut bmi = BITMAPINFO {
                            bmiHeader: BITMAPINFOHEADER {
                                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                                biWidth: dst_w as i32,
                                biHeight: -(dst_h as i32), // top-down
                                biPlanes: 1,
                                biBitCount: 32,
                                biCompression: BI_RGB.0,
                                ..Default::default()
                            },
                            ..Default::default()
                        };

                        rows = GetDIBits(
                            dst_dc,
                            dst_bitmap,
                            0,
                            dst_h,
                            Some(pixels.as_mut_ptr() as *mut c_void),
                            &mut bmi,
                            DIB_RGB_COLORS,
                        );
                    }

                    SelectObject(dst_dc, prev_dst);
                    let _ = DeleteObject(dst_bitmap.into());
                }
                let _ = DeleteDC(dst_dc);
            }
        }

        SelectObject(full_dc, prev_full);
        let _ = DeleteObject(full_bitmap.into());
        let _ = DeleteDC(full_dc);
        let _ = ReleaseDC(None, screen);

        if !printed || !copied || rows == 0 {
            return Err(RecorderError::file_error(
                "Could not capture window preview",
            ));
        }
    }

    // BGRA -> RGBA opaque
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
        px[3] = 255;
    }

    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, dst_w, dst_h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| RecorderError::file_error(format!("PNG header error: {e}")))?;
        writer
            .write_image_data(&pixels)
            .map_err(|e| RecorderError::file_error(format!("PNG encode error: {e}")))?;
    }

    Ok(png_bytes)
}

/// Capture a scaled PNG thumbnail of an application window's own content via PrintWindow.
/// `window_id` uses the `window:<hwnd>` format returned by `get_capture_windows`.
#[tauri::command]
pub async fn get_window_thumbnail(
    window_id: String,
    max_width: Option<u32>,
) -> Result<Vec<u8>, RecorderError> {
    let hwnd = window_id
        .trim()
        .strip_prefix("window:")
        .and_then(|s| s.parse::<isize>().ok())
        .ok_or_else(|| RecorderError::invalid_settings("Invalid window id"))?;

    let target_w = clamp_thumbnail_width(max_width);
    tauri::async_runtime::spawn_blocking(move || capture_window_png(hwnd, target_w))
        .await
        .map_err(|e| RecorderError::file_error(format!("Window thumbnail task failed: {e}")))?
}

/// List capturable application windows (excluding RecordFlow's own windows).
#[tauri::command]
pub async fn get_capture_windows() -> Result<Vec<WindowInfo>, RecorderError> {
    let own_pid = std::process::id();
    let windows = Window::enumerate().unwrap_or_default();
    let mut out = Vec::new();

    for w in windows {
        let title = w.title().unwrap_or_default();
        let trimmed = title.trim();
        if trimmed.is_empty() || trimmed == "Program Manager" || trimmed == "Windows Input Experience" {
            continue;
        }
        if w.process_id().map(|p| p == own_pid).unwrap_or(false) {
            continue;
        }

        let hwnd = w.as_raw_hwnd() as isize;
        let bounds = window_extended_bounds(hwnd).or_else(|| {
            w.rect().ok().and_then(|r| {
                if r.right > r.left && r.bottom > r.top {
                    Some((
                        r.left,
                        r.top,
                        (r.right - r.left) as u32,
                        (r.bottom - r.top) as u32,
                    ))
                } else {
                    None
                }
            })
        });

        let Some((_, _, width, height)) = bounds else {
            continue;
        };
        if width < 120 || height < 80 {
            continue;
        }

        let process = w
            .process_name()
            .unwrap_or_default()
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_string();

        out.push(WindowInfo {
            id: format!("window:{hwnd}"),
            title: trimmed.to_string(),
            process,
            width,
            height,
        });
    }

    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(out)
}

/// List webcams.
#[tauri::command]
pub async fn get_cameras() -> Result<Vec<CameraInfo>, RecorderError> {
    let cams = match nokhwa::query(nokhwa::utils::ApiBackend::Auto) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("RecordFlow: Camera detection failed (often normal if no camera is connected): {e}");
            return Ok(Vec::new());
        }
    };

    let mut out = Vec::with_capacity(cams.len());
    for (idx, cam) in cams.iter().enumerate() {
        let index = match cam.index() {
            nokhwa::utils::CameraIndex::Index(i) => *i as u32,
            nokhwa::utils::CameraIndex::String(_) => idx as u32,
        };

        out.push(CameraInfo {
            index,
            name: cam.human_name(),
            width: 0,
            height: 0,
        });
    }

    Ok(out)
}

/// List microphone input devices.
#[tauri::command]
pub async fn get_audio_inputs() -> Result<Vec<AudioDeviceInfo>, RecorderError> {
    let host = cpal::default_host();
    let devices = match host.input_devices() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("RecordFlow: Audio input enumeration failed: {e}");
            return Ok(Vec::new());
        }
    };

    let mut out = Vec::new();
    for (idx, dev) in devices.enumerate() {
        let name = dev.name().unwrap_or_else(|_| "Microphone".to_string());
        let cfg = dev
            .default_input_config()
            .map(|c| (c.channels(), c.sample_rate().0))
            .unwrap_or((0, 0));

        out.push(AudioDeviceInfo {
            index: idx as u32,
            name,
            channels: cfg.0,
            sample_rate: cfg.1,
            is_input: true,
        });
    }

    Ok(out)
}

/// List system audio output devices (used for Windows WASAPI loopback capture).
#[tauri::command]
pub async fn get_system_audio_devices() -> Result<Vec<AudioDeviceInfo>, RecorderError> {
    let host = cpal::default_host();
    let devices = match host.output_devices() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("RecordFlow: System audio enumeration failed: {e}");
            return Ok(Vec::new());
        }
    };

    let mut out = Vec::new();
    for (idx, dev) in devices.enumerate() {
        let name = dev.name().unwrap_or_else(|_| "Speakers".to_string());
        let cfg = dev
            .default_output_config()
            .map(|c| (c.channels(), c.sample_rate().0))
            .unwrap_or((0, 0));

        out.push(AudioDeviceInfo {
            index: idx as u32,
            name,
            channels: cfg.0,
            sample_rate: cfg.1,
            is_input: false,
        });
    }

    Ok(out)
}
