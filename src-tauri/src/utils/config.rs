use crate::commands::hotkeys::HotkeyConfig;
use crate::error::RecorderError;
use crate::state::app_state::RecordingSettings;
use crate::utils::paths::{
    ensure_writable_dir, get_app_data_dir, resolve_recordings_dir,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub last_settings: RecordingSettings,
    pub default_save_location: String,
    pub window_size: (u32, u32),
    pub theme: String,
    pub hotkeys: HotkeyConfig,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        let save_location = resolve_recordings_dir(None)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| String::new());

        Self {
            last_settings: RecordingSettings::default(),
            default_save_location: save_location,
            window_size: (1080, 720),
            theme: "graphite".to_string(),
            hotkeys: HotkeyConfig::default(),
            close_to_tray: true,
        }
    }
}

pub fn get_config_path() -> Result<PathBuf, RecorderError> {
    Ok(get_app_data_dir()?.join("config.json"))
}

pub fn load_config() -> Result<AppConfig, RecorderError> {
    let path = get_config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|e| RecorderError::file_error(format!("Failed to read config: {}", e)))?;

    serde_json::from_str::<AppConfig>(&contents).map_err(|e| {
        RecorderError::invalid_settings(format!(
            "Config file is corrupted or invalid JSON ({}): {}",
            path.to_string_lossy(),
            e
        ))
    })
}

pub fn save_config(config: &AppConfig) -> Result<(), RecorderError> {
    let path = get_config_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            RecorderError::file_error(format!("Failed to create config directory: {}", e))
        })?;
    }

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| RecorderError::invalid_settings(format!("Failed to serialize config: {}", e)))?;

    fs::write(&path, json)
        .map_err(|e| RecorderError::file_error(format!("Failed to write config: {}", e)))?;
    Ok(())
}

/// Resolves the active recordings directory, honoring `config.default_save_location` if valid
/// and automatically healing/falling back to a writable directory if the configured or default
/// `Documents` path fails (e.g. broken OneDrive junction `os error 2`).
pub fn get_default_recordings_path() -> Result<PathBuf, RecorderError> {
    let existing_cfg = load_config().ok();
    let preferred = existing_cfg
        .as_ref()
        .map(|c| c.default_save_location.as_str())
        .filter(|s| !s.trim().is_empty());

    let resolved = resolve_recordings_dir(preferred)?;
    let resolved_str = resolved.to_string_lossy().to_string();

    if let Some(mut cfg) = existing_cfg {
        if cfg.default_save_location != resolved_str {
            cfg.default_save_location = resolved_str;
            let _ = save_config(&cfg);
        }
    }

    Ok(resolved)
}

/// Explicitly sets and validates a custom recordings directory and persists it to `config.json`.
pub fn set_custom_recordings_path(custom_path: &str) -> Result<PathBuf, RecorderError> {
    let trimmed = custom_path.trim();
    if trimmed.is_empty() {
        return Err(RecorderError::invalid_settings(
            "Recordings folder path cannot be empty",
        ));
    }

    let verified = ensure_writable_dir(Path::new(trimmed)).map_err(|e| {
        RecorderError::file_error(format!(
            "Cannot write to selected folder ({trimmed}): {e}"
        ))
    })?;

    let mut cfg = load_config().unwrap_or_else(|_| AppConfig::default());
    cfg.default_save_location = verified.to_string_lossy().to_string();
    save_config(&cfg)?;

    Ok(verified)
}
