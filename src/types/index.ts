export interface DisplayInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
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

export type Resolution = "720p" | "1080p";
export type CameraPosition = "TopLeft" | "TopRight" | "BottomLeft" | "BottomRight";
export type CameraSize = "Small" | "Medium" | "Large";

export interface RecordingSettings {
  screen_enabled: boolean;
  resolution: Resolution;
  fps: number;
  bitrate: number;
  selected_display: number;
  selected_window: string | null;
  capture_region: CaptureRegion | null;
  selected_camera: string | null;
  camera_enabled: boolean;
  camera_position: CameraPosition;
  camera_size: CameraSize;
  microphone_device: string;
  mic_enabled: boolean;
  mic_volume: number;
  system_audio_device: string;
  system_audio_enabled: boolean;
  system_audio_volume: number;
}
