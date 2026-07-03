use crate::error::RecorderError;
use crate::recording::frame_overlay;
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

fn set_window_content_protected(
    window: &WebviewWindow,
    protected: bool,
) -> Result<(), RecorderError> {
    window.set_content_protected(protected).map_err(|e| {
        RecorderError::encoding_failed(format!(
            "Unable to {} RecordFlow screen-capture protection: {e}",
            if protected { "enable" } else { "disable" }
        ))
    })
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
    set_window_content_protected(&window, true)?;
    let _ = window.show();
    std::thread::sleep(Duration::from_millis(150));

    let path = match state.inner().start_recording().await {
        Ok(path) => path,
        Err(err) => {
            frame_overlay::hide_recording_frame();
            let _ = set_window_content_protected(&window, true);
            let _ = window.show();
            let _ = window.set_focus();
            return Err(err);
        }
    };

    let _ = window.show();
    let _ = window.set_focus();
    let settings = state.inner().state.get_settings();
    if let Err(err) =
        frame_overlay::show_recording_frame(settings.selected_display, settings.capture_region.as_ref())
    {
        eprintln!("RecordFlow: recording frame overlay failed: {err}");
    }
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
    frame_overlay::hide_recording_frame();
    show_main_window(&app);
    if let Ok(window) = main_window(&app) {
        let _ = set_window_content_protected(&window, true);
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
