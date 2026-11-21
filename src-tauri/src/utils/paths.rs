use crate::error::RecorderError;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Verify that `dir` can be created, is an actual directory (not a broken Windows junction),
/// and allows creating files inside it.
pub fn ensure_writable_dir(dir: &Path) -> Result<PathBuf, std::io::Error> {
    fs::create_dir_all(dir)?;
    let meta = fs::metadata(dir)?;
    if !meta.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotADirectory,
            "Path is not a directory",
        ));
    }

    let probe_name = format!(".rf_probe_{}", std::process::id());
    let probe_path = dir.join(probe_name);
    {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&probe_path)?;
        file.write_all(b"ok")?;
        file.flush()?;
    }
    let _ = fs::remove_file(&probe_path);

    Ok(dir.to_path_buf())
}

/// Returns a guaranteed-writable application data directory for config.json and history.json.
/// Falls back gracefully if `%APPDATA%` is unavailable or inaccessible.
pub fn get_app_data_dir() -> Result<PathBuf, RecorderError> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(base) = dirs::data_dir() {
        candidates.push(base.join("RecordFlow"));
    }
    if let Some(local) = dirs::data_local_dir() {
        candidates.push(local.join("RecordFlow"));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".recordflow"));
    }
    if let Some(user_profile) = std::env::var_os("USERPROFILE") {
        candidates.push(PathBuf::from(user_profile).join(".recordflow"));
    }
    candidates.push(std::env::temp_dir().join("RecordFlow_AppData"));

    let mut last_err: Option<std::io::Error> = None;
    for candidate in candidates {
        match ensure_writable_dir(&candidate) {
            Ok(valid) => return Ok(valid),
            Err(err) => {
                eprintln!(
                    "RecordFlow: app data dir candidate ({}) unavailable: {}",
                    candidate.to_string_lossy(),
                    err
                );
                last_err = Some(err);
            }
        }
    }

    Err(RecorderError::file_error(format!(
        "Could not resolve a writable application data directory: {}",
        last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "no candidate paths available".to_string())
    )))
}

/// Candidate recordings directories in priority order.
/// Handles Windows systems where `Documents` is a broken OneDrive junction (`os error 2`)
/// by automatically falling back across `Videos`, `OneDrive`, user profile root, `LocalAppData`, etc.
fn build_recordings_dir_candidates(preferred: Option<&str>) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(custom) = preferred {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed));
        }
    }

    // 1. Standard OS Videos directory (ideal for screen recordings; rarely broken by OneDrive)
    if let Some(videos) = dirs::video_dir() {
        candidates.push(videos.join("RecordFlow").join("Recordings"));
    }

    // 2. Standard OS Documents directory
    if let Some(docs) = dirs::document_dir() {
        candidates.push(docs.join("RecordFlow").join("Recordings"));
    }

    // 3. Explicit OneDrive folders if OneDrive redirection is active
    for env_key in ["OneDriveConsumer", "OneDrive"] {
        if let Some(od) = std::env::var_os(env_key) {
            let od_path = PathBuf::from(od);
            candidates.push(od_path.join("Videos").join("RecordFlow").join("Recordings"));
            candidates.push(
                od_path
                    .join("Documents")
                    .join("RecordFlow")
                    .join("Recordings"),
            );
        }
    }

    // 4. Direct user profile subpaths (immune to broken Documents/Videos shell junctions)
    let home_dirs: Vec<PathBuf> = [
        dirs::home_dir(),
        std::env::var_os("USERPROFILE").map(PathBuf::from),
    ]
    .into_iter()
    .flatten()
    .collect();

    for home in home_dirs {
        candidates.push(home.join("Videos").join("RecordFlow").join("Recordings"));
        candidates.push(home.join("RecordFlow").join("Recordings"));
    }

    // 5. LocalAppData / Roaming AppData / Desktop / Temp / Current working directory
    if let Some(local_data) = dirs::data_local_dir() {
        candidates.push(local_data.join("RecordFlow").join("Recordings"));
    }
    if let Some(roaming_data) = dirs::data_dir() {
        candidates.push(roaming_data.join("RecordFlow").join("Recordings"));
    }
    if let Some(desktop) = dirs::desktop_dir() {
        candidates.push(desktop.join("RecordFlow").join("Recordings"));
    }

    candidates.push(std::env::temp_dir().join("RecordFlow").join("Recordings"));

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("RecordFlow_Recordings"));
    }

    candidates
}

/// Resolves and creates a guaranteed-writable recordings directory.
pub fn resolve_recordings_dir(preferred: Option<&str>) -> Result<PathBuf, RecorderError> {
    let candidates = build_recordings_dir_candidates(preferred);
    let mut errors: Vec<String> = Vec::new();

    for candidate in candidates {
        match ensure_writable_dir(&candidate) {
            Ok(valid) => return Ok(valid),
            Err(err) => {
                let msg = format!("{}: {}", candidate.to_string_lossy(), err);
                eprintln!("RecordFlow: skipping unusable recordings path ({msg})");
                errors.push(msg);
            }
        }
    }

    Err(RecorderError::file_error(format!(
        "Failed to create a writable recordings directory. Tried: {}",
        errors.join(" | ")
    )))
}

pub fn get_default_recordings_path() -> Result<PathBuf, RecorderError> {
    resolve_recordings_dir(None)
}
