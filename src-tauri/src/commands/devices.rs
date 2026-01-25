use crate::error::RecorderError;
use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFOEXW};
use windows_capture::monitor::Monitor;

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
#[allow(dead_code)]
pub struct WindowInfo {
    pub window_id: u64,
    pub title: String,
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

fn monitor_rect(monitor: &Monitor) -> Result<RECT, RecorderError> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

    unsafe {
        let hmonitor = windows::Win32::Graphics::Gdi::HMONITOR(
            monitor.as_raw_hmonitor() as *mut core::ffi::c_void,
        );

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

/// List connected monitors.
#[tauri::command]
pub async fn get_displays() -> Result<Vec<DisplayInfo>, RecorderError> {
    let monitors = Monitor::enumerate().map_err(|e| {
        let err_str = e.to_string().to_lowercase();
        if err_str.contains("not supported") || err_str.contains("class not registered") || err_str.contains("0x80070032") {
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
        if is_primary {
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

/// List webcams.
#[tauri::command]
pub async fn get_cameras() -> Result<Vec<CameraInfo>, RecorderError> {
    // NOTE: nokhwa may not work on all machines due to backend/native dependencies.
    // Return empty list instead of error if camera detection fails
    let cams = match nokhwa::query(nokhwa::utils::ApiBackend::Auto) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("RecordFlow: Camera detection failed (this is often normal if no camera is connected): {}", e);
            // Return empty list instead of error - camera is optional
            return Ok(Vec::new());
        }
    };

    let mut out = Vec::with_capacity(cams.len());
    for (idx, cam) in cams.iter().enumerate() {
        // nokhwa doesn't expose native resolution without opening the camera.
        // We'll return 0x0 for now; the UI can still show device names.
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
            eprintln!("RecordFlow: Audio input enumeration failed: {}", e);
            // Return empty list if no audio devices can be enumerated
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

/// List system audio output devices.
#[tauri::command]
pub async fn get_system_audio_devices() -> Result<Vec<AudioDeviceInfo>, RecorderError> {
    let host = cpal::default_host();
    let devices = match host.output_devices() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("RecordFlow: System audio enumeration failed: {}", e);
            // Return empty list if no audio devices can be enumerated
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
