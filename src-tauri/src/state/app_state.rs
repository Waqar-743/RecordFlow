use crate::error::RecorderError;
use crate::state::history::TimerSession;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Resolution {
    #[serde(rename = "720p")]
    P720,
    #[serde(rename = "1080p")]
    P1080,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum CameraPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum CameraSize {
    Small,
    Medium,
    Large,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RecordingSettings {
    pub screen_enabled: bool,
    pub resolution: Resolution,
    pub fps: u32,
    pub bitrate: u32,
    pub selected_display: u32,
    pub selected_window: Option<String>,
    pub capture_region: Option<CaptureRegion>,
    pub selected_camera: Option<String>,
    pub camera_enabled: bool,
    pub camera_position: CameraPosition,
    pub camera_size: CameraSize,
    pub microphone_device: String,
    pub mic_enabled: bool,
    pub mic_volume: f32,
    pub system_audio_device: String,
    pub system_audio_enabled: bool,
    pub system_audio_volume: f32,
}

impl Default for RecordingSettings {
    fn default() -> Self {
        Self {
            screen_enabled: true,
            resolution: Resolution::P1080,
            fps: 30,
            bitrate: 5000,
            selected_display: 0,
            selected_window: None,
            capture_region: None,
            selected_camera: None,
            camera_enabled: false,
            camera_position: CameraPosition::BottomRight,
            camera_size: CameraSize::Medium,
            microphone_device: String::new(),
            mic_enabled: true,
            mic_volume: 0.8,
            system_audio_device: String::new(),
            system_audio_enabled: false,
            system_audio_volume: 0.6,
        }
    }
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct AppState {
    pub settings: Arc<Mutex<RecordingSettings>>,
    pub is_recording: Arc<Mutex<bool>>,
    pub is_paused: Arc<Mutex<bool>>,
    pub output_file: Arc<Mutex<Option<String>>>,
    pub history: Arc<Mutex<Vec<TimerSession>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            settings: Arc::new(Mutex::new(RecordingSettings::default())),
            is_recording: Arc::new(Mutex::new(false)),
            is_paused: Arc::new(Mutex::new(false)),
            output_file: Arc::new(Mutex::new(None)),
            history: Arc::new(Mutex::new(vec![])),
        }
    }

    pub fn set_history(&self, history: Vec<TimerSession>) {
        *self.history.lock() = history;
    }

    pub fn get_history(&self) -> Vec<TimerSession> {
        self.history.lock().clone()
    }

    pub fn push_history(&self, session: TimerSession) {
        self.history.lock().push(session);
    }

    pub fn delete_history(&self, id: &str) {
        self.history.lock().retain(|s| s.id != id);
    }

    pub fn clear_history(&self) {
        self.history.lock().clear();
    }

    #[allow(dead_code)]
    pub fn start_recording(&self, output_file: String) -> Result<(), RecorderError> {
        let mut is_recording = self.is_recording.lock();
        if *is_recording {
            return Err(RecorderError::already_recording());
        }

        *is_recording = true;
        *self.is_paused.lock() = false;
        *self.output_file.lock() = Some(output_file);
        Ok(())
    }

    #[allow(dead_code)]
    pub fn stop_recording(&self) -> Result<(), RecorderError> {
        let mut is_recording = self.is_recording.lock();
        if !*is_recording {
            return Err(RecorderError::not_recording());
        }

        *is_recording = false;
        *self.is_paused.lock() = false;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn pause_recording(&self) -> Result<(), RecorderError> {
        if !*self.is_recording.lock() {
            return Err(RecorderError::not_recording());
        }

        let mut is_paused = self.is_paused.lock();
        if *is_paused {
            return Err(RecorderError::invalid_settings("Already paused"));
        }
        *is_paused = true;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn resume_recording(&self) -> Result<(), RecorderError> {
        if !*self.is_recording.lock() {
            return Err(RecorderError::not_recording());
        }

        let mut is_paused = self.is_paused.lock();
        if !*is_paused {
            return Err(RecorderError::invalid_settings("Not paused"));
        }
        *is_paused = false;
        Ok(())
    }

    pub fn update_settings(&self, settings: RecordingSettings) {
        *self.settings.lock() = settings;
    }

    pub fn get_settings(&self) -> RecordingSettings {
        self.settings.lock().clone()
    }
}
