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
            toggle_recording: "Ctrl+Alt+Shift+R".to_string(),
            toggle_pause: "Ctrl+Alt+Shift+P".to_string(),
        }
    }
}

const TOGGLE_RECORDING_FALLBACKS: &[&str] = &[
    "Ctrl+Alt+Shift+R",
    "Ctrl+Shift+F9",
    "Alt+Shift+F9",
    "Ctrl+Alt+F9",
];

const TOGGLE_PAUSE_FALLBACKS: &[&str] = &[
    "Ctrl+Alt+Shift+P",
    "Ctrl+Shift+F10",
    "Alt+Shift+F10",
    "Ctrl+Alt+F10",
];

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
    active_config: Mutex<HotkeyConfig>,
    bindings: Mutex<Vec<(Shortcut, &'static str)>>,
    last_fired: Mutex<Option<Instant>>,
    last_failures: Mutex<Vec<HotkeyApplyFailure>>,
}

impl Default for HotkeyRuntime {
    fn default() -> Self {
        Self {
            active_config: Mutex::new(HotkeyConfig::default()),
            bindings: Mutex::new(Vec::new()),
            last_fired: Mutex::new(None),
            last_failures: Mutex::new(Vec::new()),
        }
    }
}

fn format_register_error(err: &impl std::fmt::Display) -> String {
    let raw = err.to_string();
    let lower = raw.to_lowercase();
    if lower.contains("already registered") {
        "Already in use by another application".to_string()
    } else {
        format!("Could not register shortcut ({raw})")
    }
}

fn is_already_registered_error(err: &impl std::fmt::Display) -> bool {
    err.to_string().to_lowercase().contains("already registered")
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

fn register_from_config_inner(
    app: &AppHandle,
    config: &HotkeyConfig,
    allow_fallback: bool,
) -> HotkeyApplyResult {
    let mut registered = Vec::new();
    let mut failed = Vec::new();
    let mut active_bindings: Vec<(Shortcut, &'static str)> = Vec::new();
    let mut effective = config.clone();
    let mut changed_by_fallback = false;

    let _ = app.global_shortcut().unregister_all();

    let entries: [(&'static str, String, &[&str]); 2] = [
        (
            "toggle_recording",
            config.toggle_recording.clone(),
            TOGGLE_RECORDING_FALLBACKS,
        ),
        (
            "toggle_pause",
            config.toggle_pause.clone(),
            TOGGLE_PAUSE_FALLBACKS,
        ),
    ];

    for (action, raw_accel, fallbacks) in entries {
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
                        let mut resolved_fallback: Option<String> = None;

                        if allow_fallback && is_already_registered_error(&e) {
                            for candidate in fallbacks {
                                if candidate.eq_ignore_ascii_case(trimmed) {
                                    continue;
                                }
                                let cand_norm = normalize_accelerator_for_os(candidate);
                                let Ok(cand_shortcut) = cand_norm.parse::<Shortcut>() else {
                                    continue;
                                };
                                if active_bindings
                                    .iter()
                                    .any(|(existing, _)| *existing == cand_shortcut)
                                {
                                    continue;
                                }
                                if app.global_shortcut().register(cand_shortcut).is_ok() {
                                    active_bindings.push((cand_shortcut, action));
                                    registered.push((*candidate).to_string());
                                    resolved_fallback = Some((*candidate).to_string());
                                    break;
                                }
                            }
                        }

                        if let Some(fb) = resolved_fallback {
                            if action == "toggle_recording" {
                                effective.toggle_recording = fb;
                            } else if action == "toggle_pause" {
                                effective.toggle_pause = fb;
                            }
                            changed_by_fallback = true;
                        } else {
                            failed.push(HotkeyApplyFailure {
                                action: action.to_string(),
                                accelerator: trimmed.to_string(),
                                reason: format_register_error(&e),
                            });
                        }
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

    if changed_by_fallback {
        let mut cfg = load_config().unwrap_or_else(|_| AppConfig::default());
        cfg.hotkeys = effective.clone();
        let _ = save_config(&cfg);
    }

    if let Some(runtime) = app.try_state::<HotkeyRuntime>() {
        *runtime.active_config.lock() = effective.clone();
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
        Some(effective.toggle_recording.clone()),
    );

    HotkeyApplyResult {
        hotkeys: effective,
        registered,
        failed,
    }
}

pub fn register_on_startup(app: &AppHandle, config: &HotkeyConfig) -> HotkeyApplyResult {
    register_from_config_inner(app, config, true)
}

pub fn register_from_config(app: &AppHandle, config: &HotkeyConfig) -> HotkeyApplyResult {
    register_from_config_inner(app, config, false)
}

#[tauri::command]
pub fn get_hotkeys(app: AppHandle) -> HotkeyConfig {
    if let Some(rt) = app.try_state::<HotkeyRuntime>() {
        return rt.active_config.lock().clone();
    }
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
