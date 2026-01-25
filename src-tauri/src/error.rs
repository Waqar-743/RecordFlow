use serde::Serialize;
use std::error::Error;
use std::fmt;

/// Serializable error type returned from Tauri commands.
///
/// Frontend receives this as JSON:
/// `{ code: string, message: string, details?: string }`.
#[derive(Debug, Clone, Serialize)]
pub struct RecorderError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl RecorderError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, details: Option<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details,
        }
    }

    /// Device (display/camera/mic/etc.) was not found.
    #[allow(dead_code)]
    pub fn device_not_found(device_type: impl Into<String>) -> Self {
        let device_type = device_type.into();
        Self::new(
            "DEVICE_NOT_FOUND",
            format!("{} not found. Check if it's connected and available.", device_type),
            None,
        )
    }

    /// Recording start was requested while already recording.
    #[allow(dead_code)]
    pub fn already_recording() -> Self {
        Self::new(
            "ALREADY_RECORDING",
            "Recording is already in progress.".to_string(),
            None,
        )
    }

    /// Recording stop/pause/resume was requested while not recording.
    #[allow(dead_code)]
    pub fn not_recording() -> Self {
        Self::new(
            "NOT_RECORDING",
            "No active recording.".to_string(),
            None,
        )
    }

    /// Settings payload is invalid.
    pub fn invalid_settings(reason: impl Into<String>) -> Self {
        Self::new(
            "INVALID_SETTINGS",
            "Invalid settings.".to_string(),
            Some(reason.into()),
        )
    }

    /// Encoding failed.
    #[allow(dead_code)]
    pub fn encoding_failed(reason: impl Into<String>) -> Self {
        Self::new(
            "ENCODING_FAILED",
            "Encoding failed.".to_string(),
            Some(reason.into()),
        )
    }

    /// Unsupported Windows version.
    #[allow(dead_code)]
    pub fn unsupported_windows_version() -> Self {
        Self::new(
            "UNSUPPORTED_WINDOWS_VERSION",
            "This application requires Windows 10 version 1903 (build 18362) or later.".to_string(),
            Some("The Windows Graphics Capture API is not available on your system. Please update Windows or use a newer version.".to_string()),
        )
    }

    /// File system error (read/write/create).
    pub fn file_error(reason: impl Into<String>) -> Self {
        Self::new(
            "FILE_ERROR",
            "File system error.".to_string(),
            Some(reason.into()),
        )
    }
}

impl fmt::Display for RecorderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.details {
            Some(details) => write!(f, "{}: {} ({})", self.code, self.message, details),
            None => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

impl Error for RecorderError {}

impl From<std::io::Error> for RecorderError {
    fn from(value: std::io::Error) -> Self {
        Self::file_error(value.to_string())
    }
}

impl From<serde_json::Error> for RecorderError {
    fn from(value: serde_json::Error) -> Self {
        Self::invalid_settings(value.to_string())
    }
}
