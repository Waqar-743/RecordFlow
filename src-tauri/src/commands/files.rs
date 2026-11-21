use crate::error::RecorderError;
use crate::state::app_state::AppState;
use crate::utils::config::{get_default_recordings_path, set_custom_recordings_path};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingInfo {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub duration: u64,
    pub created_at: String,
}

fn get_default_save_location() -> Result<PathBuf, RecorderError> {
    get_default_recordings_path()
}

fn file_name_only(path: &PathBuf) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string()
}

/// Return the currently active, verified recordings save folder.
#[tauri::command]
pub async fn get_recordings_folder() -> Result<String, RecorderError> {
    let dir = get_default_save_location()?;
    Ok(dir.to_string_lossy().to_string())
}

/// Update the recordings save folder to a user-selected directory.
#[tauri::command]
pub async fn set_recordings_folder(path: String) -> Result<String, RecorderError> {
    let dir = set_custom_recordings_path(&path)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Return metadata for the last output file tracked by the app state.
///
/// NOTE: `duration` is currently `0` (MP4 parsing is not yet implemented).
#[tauri::command]
pub async fn get_last_recording_info(
    state: State<'_, Arc<AppState>>,
) -> Result<RecordingInfo, RecorderError> {
    let path_str = state
        .output_file
        .lock()
        .clone()
        .ok_or_else(|| RecorderError::invalid_settings("No last recording file available"))?;

    let path = PathBuf::from(path_str.clone());
    if !path.exists() {
        return Err(RecorderError::file_error("Recording file not found"));
    }

    let meta = fs::metadata(&path)
        .map_err(|e| RecorderError::file_error(format!("Failed to read file metadata: {e}")))?;

    let created_at = meta
        .created()
        .or_else(|_| meta.modified())
        .ok()
        .map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339())
        .unwrap_or_else(|| chrono::Local::now().to_rfc3339());

    Ok(RecordingInfo {
        file_path: path_str,
        file_name: file_name_only(&path),
        file_size: meta.len(),
        duration: 0,
        created_at,
    })
}

/// Open a file in Windows Explorer and select it.
#[tauri::command]
pub async fn open_recording_in_explorer(path: String) -> Result<(), RecorderError> {
    let pb = PathBuf::from(path);
    if !pb.exists() {
        return Err(RecorderError::file_error("File not found"));
    }

    Command::new("explorer.exe")
        .arg("/select,")
        .arg(pb)
        .spawn()
        .map_err(|e| RecorderError::file_error(format!("Failed to open Explorer: {e}")))?;
    Ok(())
}

/// Delete a recording file.
#[tauri::command]
pub async fn delete_recording(path: String) -> Result<(), RecorderError> {
    let pb = PathBuf::from(path);
    if !pb.exists() {
        return Err(RecorderError::file_error("File not found"));
    }

    fs::remove_file(&pb)
        .map_err(|e| RecorderError::file_error(format!("Failed to delete file: {e}")))?;
    Ok(())
}

/// Open the recordings folder in Explorer.
#[tauri::command]
pub async fn open_recordings_folder() -> Result<(), RecorderError> {
    let dir = get_default_save_location()?;

    Command::new("explorer.exe")
        .arg(dir)
        .spawn()
        .map_err(|e| RecorderError::file_error(format!("Failed to open Explorer: {e}")))?;
    Ok(())
}
