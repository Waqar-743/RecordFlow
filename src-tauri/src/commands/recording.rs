use crate::error::RecorderError;
use crate::recording::manager::RecordingManager;
use crate::recording::status::RecordingStatus;
use crate::utils::history::save_history;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, State, WebviewWindow};

fn main_window(app: &tauri::AppHandle) -> Result<WebviewWindow, RecorderError> {
    app.get_webview_window("main")
        .ok_or_else(|| RecorderError::encoding_failed("Main window was not found"))
}

#[cfg(target_os = "windows")]
fn set_window_capture_excluded(
    window: &WebviewWindow,
    excluded: bool,
) -> Result<(), RecorderError> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let hwnd = window.hwnd().map_err(|e| {
        RecorderError::encoding_failed(format!("Unable to read window handle: {e}"))
    })?;
    let affinity = if excluded {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    unsafe { SetWindowDisplayAffinity(hwnd, affinity) }.map_err(|e| {
        RecorderError::encoding_failed(format!(
            "Unable to {} RecordFlow from screen capture: {}",
            if excluded { "exclude" } else { "restore" },
            e
        ))
    })
}

#[cfg(not(target_os = "windows"))]
fn set_window_capture_excluded(
    _window: &WebviewWindow,
    _excluded: bool,
) -> Result<(), RecorderError> {
    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    match main_window(app) {
        Ok(window) => {
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(err) => eprintln!("RecordFlow: failed to show main window: {err}"),
    }
}

/// Begin recording with the current settings.
#[tauri::command]
pub async fn start_recording(
    app: tauri::AppHandle,
    state: State<'_, Arc<RecordingManager>>,
) -> Result<String, RecorderError> {
    let window = main_window(&app)?;
    set_window_capture_excluded(&window, true)?;
    let _ = window.hide();
    std::thread::sleep(Duration::from_millis(350));

    let path = match state.inner().start_recording().await {
        Ok(path) => path,
        Err(err) => {
            let _ = set_window_capture_excluded(&window, false);
            let _ = window.show();
            let _ = window.set_focus();
            return Err(err);
        }
    };

    let _ = window.show();
    let _ = window.set_focus();
    state.inner().start_tick_emitter(app);
    Ok(path)
}

/// Stop recording and return final status.
#[tauri::command]
pub async fn stop_recording(
    app: tauri::AppHandle,
    state: State<'_, Arc<RecordingManager>>,
) -> Result<RecordingStatus, RecorderError> {
    let stop_result = state.inner().stop_recording().await;
    show_main_window(&app);
    if let Ok(window) = main_window(&app) {
        let _ = set_window_capture_excluded(&window, false);
    }
    let _path = stop_result?;

    if let Some(session) = state.inner().take_last_session() {
        state.inner().state.push_history(session);
        let sessions = state.inner().state.get_history();
        save_history(&sessions)?;
    }

    let status = state.inner().snapshot_status();
    let _ = app.emit("recording_status", status.clone());

    Ok(status)
}

/// Pause an in-progress recording.
#[tauri::command]
pub async fn pause_recording(
    app: tauri::AppHandle,
    state: State<'_, Arc<RecordingManager>>,
) -> Result<String, RecorderError> {
    let res = state.inner().pause_recording().await?;
    let _ = app.emit("recording_status", state.inner().snapshot_status());
    Ok(res)
}

/// Resume a paused recording.
#[tauri::command]
pub async fn resume_recording(
    app: tauri::AppHandle,
    state: State<'_, Arc<RecordingManager>>,
) -> Result<String, RecorderError> {
    let res = state.inner().resume_recording().await?;
    let _ = app.emit("recording_status", state.inner().snapshot_status());
    Ok(res)
}

/// Get current recording status (recording/paused/output/elapsed seconds).
#[tauri::command]
pub async fn get_recording_status(
    state: State<'_, Arc<RecordingManager>>,
) -> Result<RecordingStatus, RecorderError> {
    Ok(state.inner().snapshot_status())
}

// Alias commands for a "timer" app naming convention.
#[tauri::command]
pub async fn start_timer(
    app: tauri::AppHandle,
    state: State<'_, Arc<RecordingManager>>,
) -> Result<String, RecorderError> {
    start_recording(app, state).await
}

#[tauri::command]
pub async fn stop_timer(
    app: tauri::AppHandle,
    state: State<'_, Arc<RecordingManager>>,
) -> Result<RecordingStatus, RecorderError> {
    stop_recording(app, state).await
}

#[tauri::command]
pub async fn pause_timer(
    app: tauri::AppHandle,
    state: State<'_, Arc<RecordingManager>>,
) -> Result<String, RecorderError> {
    pause_recording(app, state).await
}

#[tauri::command]
pub async fn resume_timer(
    app: tauri::AppHandle,
    state: State<'_, Arc<RecordingManager>>,
) -> Result<String, RecorderError> {
    resume_recording(app, state).await
}

#[tauri::command]
pub async fn get_timer_state(
    state: State<'_, Arc<RecordingManager>>,
) -> Result<RecordingStatus, RecorderError> {
    get_recording_status(state).await
}
