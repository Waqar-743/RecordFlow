use crate::error::RecorderError;
use crate::state::app_state::CaptureRegion;
use std::ffi::c_void;
use std::sync::mpsc;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use windows::core::w;
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateSolidBrush, GetMonitorInfoW, HBRUSH, HMONITOR, MONITORINFOEXW,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, PeekMessageW,
    RegisterClassW, SetLayeredWindowAttributes, SetWindowDisplayAffinity, ShowWindow,
    TranslateMessage, HMENU, LWA_ALPHA, MSG, PM_REMOVE, SW_HIDE, SW_SHOWNOACTIVATE,
    WDA_EXCLUDEFROMCAPTURE, WNDCLASSW, WINDOW_EX_STYLE, WINDOW_STYLE, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP, WS_VISIBLE,
};
use windows_capture::monitor::Monitor;

const BORDER_THICKNESS: i32 = 2;
const H264_DIMENSION_ALIGNMENT: u32 = 16;

static OVERLAY_THREAD: OnceLock<mpsc::Sender<OverlayCommand>> = OnceLock::new();
static CLASS_REGISTERED: OnceLock<()> = OnceLock::new();
static CLASS_BRUSH: OnceLock<isize> = OnceLock::new();

enum OverlayCommand {
    Show {
        selected_display: u32,
        region: Option<CaptureRegion>,
        response: mpsc::Sender<Result<(), RecorderError>>,
    },
    Hide,
}

#[derive(Clone, Copy)]
struct DisplayBounds {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl DisplayBounds {
    fn width(self) -> u32 {
        self.right.saturating_sub(self.left).max(0) as u32
    }

    fn height(self) -> u32 {
        self.bottom.saturating_sub(self.top).max(0) as u32
    }
}

#[derive(Clone, Copy)]
struct FrameRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

unsafe extern "system" fn frame_window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn win32_error(message: impl Into<String>) -> RecorderError {
    RecorderError::encoding_failed(format!(
        "{}: {}",
        message.into(),
        windows::core::Error::from_win32()
    ))
}

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

fn monitor_rect(monitor: &Monitor) -> Result<RECT, RecorderError> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

    unsafe {
        let hmonitor = HMONITOR(monitor.as_raw_hmonitor() as *mut c_void);
        let ok = GetMonitorInfoW(hmonitor, &mut info as *mut MONITORINFOEXW as *mut _).as_bool();
        if !ok {
            return Err(win32_error("GetMonitorInfoW failed"));
        }
    }

    Ok(info.monitorInfo.rcMonitor)
}

fn selected_display_bounds(selected_display: u32) -> Result<DisplayBounds, RecorderError> {
    let monitors = Monitor::enumerate().map_err(|e| RecorderError::file_error(e.to_string()))?;
    let monitor = monitors
        .get(selected_display as usize)
        .ok_or_else(|| RecorderError::device_not_found("Display"))?;
    let rect = monitor_rect(monitor)?;

    Ok(DisplayBounds {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    })
}

fn capture_frame_rect(
    display: DisplayBounds,
    region: Option<&CaptureRegion>,
) -> Result<FrameRect, RecorderError> {
    let capture = region.cloned().unwrap_or(CaptureRegion {
        x: 0,
        y: 0,
        width: display.width(),
        height: display.height(),
    });

    let width = aligned_dimension_inside(capture.width)?;
    let height = aligned_dimension_inside(capture.height)?;

    Ok(FrameRect {
        x: display.left + capture.x as i32,
        y: display.top + capture.y as i32,
        width: width as i32,
        height: height as i32,
    })
}

fn frame_strips(frame: FrameRect, display: DisplayBounds) -> [FrameRect; 4] {
    let thickness = BORDER_THICKNESS
        .min((frame.width / 2).max(1))
        .min((frame.height / 2).max(1));

    let top_y = if frame.y - thickness >= display.top {
        frame.y - thickness
    } else {
        frame.y
    };
    let bottom_y = if frame.y + frame.height + thickness <= display.bottom {
        frame.y + frame.height
    } else {
        frame.y + (frame.height - thickness).max(0)
    };
    let left_x = if frame.x - thickness >= display.left {
        frame.x - thickness
    } else {
        frame.x
    };
    let right_x = if frame.x + frame.width + thickness <= display.right {
        frame.x + frame.width
    } else {
        frame.x + (frame.width - thickness).max(0)
    };

    [
        FrameRect {
            x: frame.x,
            y: top_y,
            width: frame.width,
            height: thickness,
        },
        FrameRect {
            x: right_x,
            y: frame.y,
            width: thickness,
            height: frame.height,
        },
        FrameRect {
            x: frame.x,
            y: bottom_y,
            width: frame.width,
            height: thickness,
        },
        FrameRect {
            x: left_x,
            y: frame.y,
            width: thickness,
            height: frame.height,
        },
    ]
}

fn ensure_window_class() -> Result<(), RecorderError> {
    if CLASS_REGISTERED.get().is_some() {
        return Ok(());
    }

    unsafe {
        let module = GetModuleHandleW(None).map_err(|_| win32_error("GetModuleHandleW failed"))?;
        let instance = HINSTANCE(module.0);
        let brush = HBRUSH(
            *CLASS_BRUSH.get_or_init(|| CreateSolidBrush(COLORREF(0x00514137)).0 as isize)
                as *mut c_void,
        );
        let class = WNDCLASSW {
            lpfnWndProc: Some(frame_window_proc),
            hInstance: instance,
            hbrBackground: brush,
            lpszClassName: w!("RecordFlowRecordingFrameOverlay"),
            ..Default::default()
        };

        if RegisterClassW(&class) == 0 {
            return Err(win32_error("RegisterClassW failed"));
        }
    }

    let _ = CLASS_REGISTERED.set(());
    Ok(())
}

fn create_strip(rect: FrameRect) -> Result<HWND, RecorderError> {
    unsafe {
        let module = GetModuleHandleW(None).map_err(|_| win32_error("GetModuleHandleW failed"))?;
        let instance = HINSTANCE(module.0);
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE(
                WS_EX_LAYERED.0
                    | WS_EX_TRANSPARENT.0
                    | WS_EX_TOPMOST.0
                    | WS_EX_TOOLWINDOW.0
                    | WS_EX_NOACTIVATE.0,
            ),
            w!("RecordFlowRecordingFrameOverlay"),
            w!(""),
            WINDOW_STYLE(WS_POPUP.0 | WS_VISIBLE.0),
            rect.x,
            rect.y,
            rect.width.max(1),
            rect.height.max(1),
            None,
            None::<HMENU>,
            Some(instance),
            None,
        )
        .map_err(|_| win32_error("CreateWindowExW failed"))?;

        if let Err(err) = SetLayeredWindowAttributes(hwnd, COLORREF(0), 205, LWA_ALPHA) {
            let _ = DestroyWindow(hwnd);
            return Err(RecorderError::encoding_failed(format!(
                "SetLayeredWindowAttributes failed: {err}"
            )));
        }

        if let Err(err) = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) {
            eprintln!(
                "RecordFlow: recording frame display-affinity protection failed: {}",
                err
            );
        }

        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        Ok(hwnd)
    }
}

fn destroy_windows(windows: &mut Vec<isize>) {
    for hwnd in windows.drain(..) {
        unsafe {
            let hwnd = HWND(hwnd as *mut c_void);
            let _ = ShowWindow(hwnd, SW_HIDE);
            let _ = DestroyWindow(hwnd);
        }
    }
}

fn show_recording_frame_on_overlay_thread(
    windows: &mut Vec<isize>,
    selected_display: u32,
    region: Option<CaptureRegion>,
) -> Result<(), RecorderError> {
    destroy_windows(windows);
    ensure_window_class()?;

    let display = selected_display_bounds(selected_display)?;
    let frame = capture_frame_rect(display, region.as_ref())?;
    let strips = frame_strips(frame, display);

    for strip in strips {
        match create_strip(strip) {
            Ok(hwnd) => windows.push(hwnd.0 as isize),
            Err(err) => {
                destroy_windows(windows);
                return Err(err);
            }
        }
    }

    Ok(())
}

fn pump_overlay_messages() {
    unsafe {
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

fn overlay_sender() -> &'static mpsc::Sender<OverlayCommand> {
    OVERLAY_THREAD.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<OverlayCommand>();
        thread::spawn(move || {
            let mut windows = Vec::new();
            loop {
                pump_overlay_messages();
                match rx.recv_timeout(Duration::from_millis(30)) {
                    Ok(OverlayCommand::Hide) => {
                        destroy_windows(&mut windows);
                    }
                    Ok(OverlayCommand::Show {
                        selected_display,
                        region,
                        response,
                    }) => {
                        let result = show_recording_frame_on_overlay_thread(
                            &mut windows,
                            selected_display,
                            region,
                        );
                        let _ = response.send(result);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        destroy_windows(&mut windows);
                        break;
                    }
                }
            }
        });
        tx
    })
}

pub fn hide_recording_frame() {
    let _ = overlay_sender().send(OverlayCommand::Hide);
}

pub fn show_recording_frame(
    selected_display: u32,
    region: Option<&CaptureRegion>,
) -> Result<(), RecorderError> {
    let (response_tx, response_rx) = mpsc::channel();
    overlay_sender()
        .send(OverlayCommand::Show {
            selected_display,
            region: region.cloned(),
            response: response_tx,
        })
        .map_err(|e| RecorderError::encoding_failed(format!("Recording frame thread stopped: {e}")))?;

    response_rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|e| RecorderError::encoding_failed(format!("Recording frame did not respond: {e}")))?
}
