use crate::error::RecorderError;
use crate::tray::update_tray_indicator;
use crate::utils::config::{load_config, save_config, AppConfig};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HotkeyConfig {
    pub toggle_recording: String,
    pub toggle_pause: String,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            toggle_recording: "Alt+Shift+R".to_string(),
            toggle_pause: "Alt+Shift+P".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct HotkeyApplyFailure {
    pub action: String,
    pub accelerator: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HotkeyApplyResult {
    pub hotkeys: HotkeyConfig,
    pub registered: Vec<String>,
    pub failed: Vec<HotkeyApplyFailure>,
}

pub struct HotkeyRuntime {
    bindings: Mutex<Vec<(Shortcut, &'static str)>>,
    last_fired: Mutex<Option<Instant>>,
    last_failures: Mutex<Vec<HotkeyApplyFailure>>,
}

impl Default for HotkeyRuntime {
    fn default() -> Self {
        Self {
            bindings: Mutex::new(Vec::new()),
            last_fired: Mutex::new(None),
            last_failures: Mutex::new(Vec::new()),
        }
    }
}

/// Normalize cross-platform accelerator names ("CmdOrCtrl") into tokens accepted by `global-hotkey`.
fn normalize_accelerator_for_os(accel: &str) -> String {
    let modifier = if cfg!(target_os = "macos") {
        "Super"
    } else {
        "Ctrl"
    };
    accel
        .split('+')
        .map(|part| {
            let trimmed = part.trim();
            if trimmed.eq_ignore_ascii_case("cmdorctrl")
                || trimmed.eq_ignore_ascii_case("commandorcontrol")
            {
                modifier.to_string()
            } else {
                trimmed.to_string()
            }
        })
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}

pub fn handle_shortcut_event(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }

    let Some(runtime) = app.try_state::<HotkeyRuntime>() else {
        return;
    };

    // Debounce OS key-repeat events (350 ms)
    {
        let mut last = runtime.last_fired.lock();
        if let Some(prev) = *last {
            if prev.elapsed() < Duration::from_millis(350) {
                return;
            }
        }
        *last = Some(Instant::now());
    }

    let action = {
        let bindings = runtime.bindings.lock();
        bindings
            .iter()
            .find(|(sc, _)| sc == shortcut)
            .map(|(_, action)| *action)
    };

    if let Some(action) = action {
        let _ = app.emit_to(
            "main",
            "recordflow-hotkey",
            serde_json::json!({ "action": action, "source": "global" }),
        );
    }
}

pub fn register_from_config(app: &AppHandle, config: &HotkeyConfig) -> HotkeyApplyResult {
    let mut registered = Vec::new();
    let mut failed = Vec::new();
    let mut active_bindings: Vec<(Shortcut, &'static str)> = Vec::new();

    let _ = app.global_shortcut().unregister_all();

    let entries: [(&'static str, &str); 2] = [
        ("toggle_recording", config.toggle_recording.as_str()),
        ("toggle_pause", config.toggle_pause.as_str()),
    ];

    for (action, raw_accel) in entries {
        let trimmed = raw_accel.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = normalize_accelerator_for_os(trimmed);
        match normalized.parse::<Shortcut>() {
            Ok(shortcut) => {
                // Skip duplicate accelerator binding
                if active_bindings.iter().any(|(existing, _)| *existing == shortcut) {
                    failed.push(HotkeyApplyFailure {
                        action: action.to_string(),
                        accelerator: trimmed.to_string(),
                        reason: "Shortcut is already assigned to another RecordFlow action."
                            .to_string(),
                    });
                    continue;
                }

                match app.global_shortcut().register(shortcut) {
                    Ok(()) => {
                        active_bindings.push((shortcut, action));
                        registered.push(trimmed.to_string());
                    }
                    Err(e) => {
                        failed.push(HotkeyApplyFailure {
                            action: action.to_string(),
                            accelerator: trimmed.to_string(),
                            reason: format!("Could not register shortcut ({e})"),
                        });
                    }
                }
            }
            Err(e) => {
                failed.push(HotkeyApplyFailure {
                    action: action.to_string(),
                    accelerator: trimmed.to_string(),
                    reason: format!("Invalid shortcut syntax ({e})"),
                });
            }
        }
    }

    if let Some(runtime) = app.try_state::<HotkeyRuntime>() {
        *runtime.bindings.lock() = active_bindings;
        *runtime.last_failures.lock() = failed.clone();
    }

    let (is_recording, is_paused) = app
        .try_state::<std::sync::Arc<crate::state::app_state::AppState>>()
        .map(|st| (*st.is_recording.lock(), *st.is_paused.lock()))
        .unwrap_or((false, false));

    update_tray_indicator(
        app,
        is_recording,
        is_paused,
        Some(config.toggle_recording.clone()),
    );

    HotkeyApplyResult {
        hotkeys: config.clone(),
        registered,
        failed,
    }
}

#[tauri::command]
pub fn get_hotkeys() -> HotkeyConfig {
    load_config()
        .map(|cfg| cfg.hotkeys)
        .unwrap_or_else(|_| HotkeyConfig::default())
}

#[tauri::command]
pub fn get_hotkey_failures(app: AppHandle) -> Vec<HotkeyApplyFailure> {
    app.try_state::<HotkeyRuntime>()
        .map(|rt| rt.last_failures.lock().clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_hotkeys(
    app: AppHandle,
    hotkeys: HotkeyConfig,
) -> Result<HotkeyApplyResult, RecorderError> {
    let mut cfg = load_config().unwrap_or_else(|_| AppConfig::default());
    cfg.hotkeys = hotkeys.clone();
    save_config(&cfg)?;

    Ok(register_from_config(&app, &hotkeys))
}
