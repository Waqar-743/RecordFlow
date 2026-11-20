//! System tray: start/stop/pause recording from the tray, keep RecordFlow running
//! in the background when closed so global hotkeys keep working, and draw a live
//! status indicator dot (red = recording, amber = paused) onto the tray icon.

use crate::error::RecorderError;
use crate::utils::config::{load_config, save_config, AppConfig};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Runtime, WindowEvent};

pub struct TrayState<R: Runtime> {
    toggle_recording: MenuItem<R>,
    toggle_pause: MenuItem<R>,
    tray: TrayIcon<R>,
    idle_icon: Image<'static>,
    recording_icon: Image<'static>,
    paused_icon: Image<'static>,
    pub close_to_tray: AtomicBool,
    pub quitting: AtomicBool,
    shortcut: Mutex<String>,
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Overlay a crisp status dot with white ring in the bottom-right corner of the tray icon.
fn with_status_dot(icon: &Image<'_>, rgb: [u8; 3]) -> Image<'static> {
    let (w, h) = (icon.width(), icon.height());
    let mut rgba = icon.rgba().to_vec();
    let r = (w.min(h) as f32) * 0.25;
    let (cx, cy) = (w as f32 - r - 1.0, h as f32 - r - 1.0);
    for y in 0..h {
        for x in 0..w {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let i = ((y * w + x) * 4) as usize;
            if d <= r + 1.3 && d > r {
                rgba[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
            } else if d <= r {
                rgba[i..i + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
            }
        }
    }
    Image::new_owned(rgba, w, h)
}

fn build_tooltip(recording: bool, paused: bool, shortcut: &str) -> String {
    let key = if shortcut.trim().is_empty() {
        String::new()
    } else {
        format!(" ({})", shortcut.trim())
    };
    if recording && paused {
        format!("RecordFlow — Paused{}", key)
    } else if recording {
        format!("RecordFlow — Recording{}", key)
    } else {
        format!("RecordFlow — Ready{}", key)
    }
}

pub fn setup(app: &App, initial_close_to_tray: bool, initial_shortcut: String) -> tauri::Result<()> {
    let handle = app.handle();
    let toggle_recording =
        MenuItem::with_id(handle, "toggle_recording", "Start Recording", true, None::<&str>)?;
    let toggle_pause =
        MenuItem::with_id(handle, "toggle_pause", "Pause Recording", false, None::<&str>)?;
    let open = MenuItem::with_id(handle, "open", "Open RecordFlow", true, None::<&str>)?;
    let check_updates =
        MenuItem::with_id(handle, "check_updates", "Check for Updates", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(handle)?;
    let quit = MenuItem::with_id(handle, "quit", "Quit RecordFlow", true, None::<&str>)?;

    let menu = Menu::with_items(
        handle,
        &[&toggle_recording, &toggle_pause, &open, &check_updates, &sep, &quit],
    )?;

    let idle_icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?.to_owned();
    let recording_icon = with_status_dot(&idle_icon, [239, 68, 68]); // Red
    let paused_icon = with_status_dot(&idle_icon, [245, 158, 11]); // Amber

    let tray = TrayIconBuilder::with_id("recordflow-tray")
        .icon(idle_icon.clone())
        .tooltip(build_tooltip(false, false, &initial_shortcut))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_recording" => {
                let _ = app.emit_to(
                    "main",
                    "recordflow-hotkey",
                    serde_json::json!({ "action": "toggle_recording", "source": "tray" }),
                );
            }
            "toggle_pause" => {
                let _ = app.emit_to(
                    "main",
                    "recordflow-hotkey",
                    serde_json::json!({ "action": "toggle_pause", "source": "tray" }),
                );
            }
            "open" => show_main_window(app),
            "check_updates" => {
                show_main_window(app);
                let _ = app.emit_to("main", "recordflow-check-updates", ());
            }
            "quit" => {
                if let Some(state) = app.try_state::<TrayState<tauri::Wry>>() {
                    state.quitting.store(true, Ordering::Relaxed);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(handle)?;

    app.manage(TrayState {
        toggle_recording,
        toggle_pause,
        tray,
        idle_icon,
        recording_icon,
        paused_icon,
        close_to_tray: AtomicBool::new(initial_close_to_tray),
        quitting: AtomicBool::new(false),
        shortcut: Mutex::new(initial_shortcut),
    });

    if let Some(window) = app.get_webview_window("main") {
        let app_handle = handle.clone();
        let win = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = app_handle.try_state::<TrayState<tauri::Wry>>() {
                    if state.close_to_tray.load(Ordering::Relaxed)
                        && !state.quitting.load(Ordering::Relaxed)
                    {
                        api.prevent_close();
                        let _ = win.hide();
                    }
                }
            }
        });
    }

    Ok(())
}

pub fn update_tray_indicator(
    app: &AppHandle,
    recording: bool,
    paused: bool,
    shortcut: Option<String>,
) {
    let Some(state) = app.try_state::<TrayState<tauri::Wry>>() else {
        return;
    };
    if let Some(s) = shortcut {
        *state.shortcut.lock() = s;
    }
    let key = state.shortcut.lock().clone();
    let _ = state.toggle_recording.set_text(if recording {
        "Stop Recording"
    } else {
        "Start Recording"
    });
    let _ = state.toggle_pause.set_enabled(recording);
    let _ = state.toggle_pause.set_text(if paused {
        "Resume Recording"
    } else {
        "Pause Recording"
    });
    let _ = state.tray.set_tooltip(Some(build_tooltip(recording, paused, &key)));
    let icon = if recording && paused {
        state.paused_icon.clone()
    } else if recording {
        state.recording_icon.clone()
    } else {
        state.idle_icon.clone()
    };
    let _ = state.tray.set_icon(Some(icon));
}

#[tauri::command]
pub fn set_tray_state(
    app: AppHandle,
    recording: bool,
    paused: Option<bool>,
    shortcut: Option<String>,
) -> Result<(), RecorderError> {
    update_tray_indicator(&app, recording, paused.unwrap_or(false), shortcut);
    Ok(())
}

#[tauri::command]
pub fn get_close_to_tray(app: AppHandle) -> bool {
    app.try_state::<TrayState<tauri::Wry>>()
        .map(|s| s.close_to_tray.load(Ordering::Relaxed))
        .unwrap_or(true)
}

#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) -> Result<(), RecorderError> {
    if let Some(state) = app.try_state::<TrayState<tauri::Wry>>() {
        state.close_to_tray.store(enabled, Ordering::Relaxed);
    }
    let mut cfg = load_config().unwrap_or_else(|_| AppConfig::default());
    cfg.close_to_tray = enabled;
    save_config(&cfg)?;
    Ok(())
}

#[tauri::command]
pub fn minimize_main_window(app: AppHandle) -> Result<(), RecorderError> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
    Ok(())
}

#[tauri::command]
pub fn restore_main_window(app: AppHandle) -> Result<(), RecorderError> {
    show_main_window(&app);
    Ok(())
}
