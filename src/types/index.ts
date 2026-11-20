export interface DisplayInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
}

export interface WindowInfo {
  id: string;
  title: string;
  process: string;
  width: number;
  height: number;
}

export interface CameraInfo {
  index: number;
  name: string;
  width: number;
  height: number;
}

export interface AudioDeviceInfo {
  index: number;
  name: string;
  channels: number;
  sample_rate: number;
  is_input: boolean;
}

export interface RecordingStatus {
  is_recording: boolean;
  is_paused: boolean;
  output_file: string | null;
  elapsed_seconds: number;
}

export type TimerSessionStatus = "completed" | "failed";

export interface TimerSession {
  id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  status: TimerSessionStatus;
  output_file: string | null;
}

export interface RecordingInfo {
  file_path: string;
  file_name: string;
  file_size: number;
  duration: number;
  created_at: string;
}

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CaptureMode = "Screen" | "Area" | "Window";
export type Resolution = "720p" | "1080p" | "Native";
export type CameraPosition = "TopLeft" | "TopRight" | "BottomLeft" | "BottomRight";
export type CameraSize = "Small" | "Medium" | "Large";
export type CameraShape = "Rectangle" | "Rounded" | "Circle";

export interface HotkeyConfig {
  toggle_recording: string;
  toggle_pause: string;
}

export interface HotkeyApplyFailure {
  action: string;
  accelerator: string;
  reason: string;
}

export interface HotkeyApplyResult {
  hotkeys: HotkeyConfig;
  registered: string[];
  failed: HotkeyApplyFailure[];
}

export interface RecordingSettings {
  screen_enabled: boolean;
  capture_mode: CaptureMode;
  resolution: Resolution;
  fps: number;
  bitrate: number;
  capture_cursor: boolean;
  selected_display: number;
  selected_window: string | null;
  capture_region: CaptureRegion | null;
  selected_camera: string | null;
  camera_enabled: boolean;
  camera_position: CameraPosition;
  camera_size: CameraSize;
  camera_shape: CameraShape;
  camera_mirror: boolean;
  microphone_device: string;
  mic_enabled: boolean;
  mic_volume: number;
  system_audio_device: string;
  system_audio_enabled: boolean;
  system_audio_volume: number;
  countdown_seconds: number;
  auto_minimize: boolean;
}
