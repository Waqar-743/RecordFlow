mod commands;
mod error;
mod recording;
mod state;
mod tray;
mod utils;

use crate::commands::devices::{
    get_audio_inputs, get_cameras, get_capture_windows, get_display_thumbnail, get_displays,
    get_system_audio_devices, get_window_thumbnail,
};
use crate::commands::files::{
    delete_recording, get_last_recording_info, get_recordings_folder, open_recording_in_explorer,
    open_recordings_folder, set_recordings_folder,
};
use crate::commands::history::{clear_timer_history, delete_timer_session, get_timer_history};
use crate::commands::hotkeys::{
    get_hotkey_failures, get_hotkeys, handle_shortcut_event, register_from_config, set_hotkeys,
    HotkeyRuntime,
};
use crate::commands::recording::{
    get_recording_status, get_timer_state, pause_recording, pause_timer, resume_recording,
    resume_timer, start_recording, start_timer, stop_recording, stop_timer,
};
use crate::commands::settings::{get_settings, update_settings};
use crate::recording::manager::RecordingManager;
use crate::state::app_state::AppState;
use crate::tray::{
    get_close_to_tray, minimize_main_window, restore_main_window, set_close_to_tray, set_tray_state,
};
use crate::utils::config::{load_config, AppConfig};
use crate::utils::history::load_history;
use std::sync::Arc;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(AppState::new());
    let recording_manager = Arc::new(RecordingManager::new(app_state.clone()));

    let initial_config = match load_config() {
        Ok(cfg) => {
            app_state.update_settings(cfg.last_settings.clone());
            cfg
        }
        Err(err) => {
            eprintln!("RecordFlow: failed to load config, using defaults: {err}");
            AppConfig::default()
        }
    };

    match load_history() {
        Ok(history) => app_state.set_history(history),
        Err(err) => eprintln!("RecordFlow: failed to load history, starting empty: {err}"),
    }

    let initial_hotkeys = initial_config.hotkeys.clone();
    let initial_close_to_tray = initial_config.close_to_tray;

    tauri::Builder::default()
        .manage(app_state)
        .manage(recording_manager)
        .manage(HotkeyRuntime::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    handle_shortcut_event(app, shortcut, event);
                })
                .build(),
        )
        .setup(move |app| {
            if let Err(err) = tray::setup(
                app,
                initial_close_to_tray,
                initial_hotkeys.toggle_recording.clone(),
            ) {
                eprintln!("RecordFlow: failed to initialize system tray: {err}");
            }

            let res = register_from_config(app.handle(), &initial_hotkeys);
            if !res.failed.is_empty() {
                eprintln!(
                    "RecordFlow: some global shortcuts could not be registered: {:?}",
                    res.failed
                );
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            // Settings
            get_settings,
            update_settings,
            // Devices
            get_displays,
            get_display_thumbnail,
            get_window_thumbnail,
            get_capture_windows,
            get_cameras,
            get_audio_inputs,
            get_system_audio_devices,
            // Recording
            start_recording,
            stop_recording,
            pause_recording,
            resume_recording,
            get_recording_status,
            // Timer aliases
            start_timer,
            stop_timer,
            pause_timer,
            resume_timer,
            get_timer_state,
            // Files
            get_last_recording_info,
            get_recordings_folder,
            set_recordings_folder,
            open_recording_in_explorer,
            delete_recording,
            open_recordings_folder,
            // History
            get_timer_history,
            delete_timer_session,
            clear_timer_history,
            // Global Hotkeys & Tray / Window
            get_hotkeys,
            get_hotkey_failures,
            set_hotkeys,
            set_tray_state,
            get_close_to_tray,
            set_close_to_tray,
            minimize_main_window,
            restore_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
