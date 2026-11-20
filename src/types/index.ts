export type WorkspaceMode = "record" | "edit";

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

// ============================================================================
// Post-Recording Studio & Project Model
// ============================================================================

export type AspectRatioId = "16:9" | "9:16" | "1:1" | "4:5" | "original";
export type FramingMode = "fit" | "fill";
export type ZoomIntensityPreset = "subtle" | "balanced" | "close";
export type EditorCameraShape = "circle" | "rounded" | "square";
export type CameraSnapPreset =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center-bottom"
  | "center-left"
  | "center-right";

export type InspectorTab = "canvas" | "zoom" | "cursor" | "audio" | "camera" | "blur";

export interface CursorSample {
  t: number;
  x: number;
  y: number;
}

export interface CursorClick {
  t: number;
  x: number;
  y: number;
  button: number; // 0 = left, 1 = right
}

export interface CursorTrackData {
  version: number;
  width: number;
  height: number;
  samples: CursorSample[];
  clicks: CursorClick[];
}

export interface ZoomKeyframe {
  id: string;
  start: number;
  duration: number;
  scale: number; // e.g. 1.35, 1.75, 2.25
  focusX: number; // normalized 0..1
  focusY: number; // normalized 0..1
  intensity: ZoomIntensityPreset;
}

export interface BlurRegion {
  id: string;
  label: string;
  x: number; // normalized 0..1 relative to video frame
  y: number;
  width: number;
  height: number;
  intensity: number; // px blur radius (6..32)
  startTime: number;
  endTime: number;
  alwaysVisible: boolean;
}

export interface CanvasStyleConfig {
  aspectRatio: AspectRatioId;
  framing: FramingMode;
  backgroundId: string;
  customBackgroundUrl: string | null;
  padding: number; // 0..16 (% of canvas)
  cornerRadius: number; // 0..40 px
  shadow: number; // 0..100
}

export interface CameraOverlayConfig {
  enabled: boolean;
  /** Normalized center position in canvas coordinates (0..1) */
  x: number;
  y: number;
  /** Diameter / width fraction relative to canvas min dimension (0.12..0.42) */
  scale: number;
  shape: EditorCameraShape;
  cornerRadius: number; // used when shape === "rounded" (8..48)
  mirror: boolean;
  borderWidth: number; // 0..8
  borderColor: string;
  shadow: number; // 0..100
  opacity: number; // 0.3..1
}

export interface CursorStyleConfig {
  enabled: boolean;
  scale: number; // 0.8..2.4
  clickRipple: boolean;
  rippleColor: string;
  highlightHalo: boolean;
  smoothMotion: boolean;
}

export interface AudioMixConfig {
  micVolume: number; // 0..2
  micMuted: boolean;
  systemVolume: number; // 0..2
  systemMuted: boolean;
  masterVolume: number; // 0..1.5
  fadeIn: boolean;
  fadeOut: boolean;
}

export interface EditorProject {
  version: 2;
  id: string;
  name: string;
  createdAt: string;
  /** Screen recording source (asset URL, blob URL, or file path) */
  screenUrl: string;
  screenPath: string | null;
  /** Independent synchronized webcam recording source */
  cameraUrl: string | null;
  cameraPath: string | null;
  /** Optional separate microphone audio track (browser mode) */
  micAudioUrl?: string | null;
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  trimStart: number;
  trimEnd: number;
  canvas: CanvasStyleConfig;
  camera: CameraOverlayConfig;
  cursor: CursorStyleConfig;
  audio: AudioMixConfig;
  zooms: ZoomKeyframe[];
  blurs: BlurRegion[];
  cursorTrack: CursorTrackData | null;
  waveform: number[];
  isDemo?: boolean;
}

export type ExportFormat = "mp4" | "webm";
export type ExportResolution = "4k" | "1440p" | "1080p" | "720p";
export type ExportFps = 60 | 30;
export type ExportQuality = "best" | "high" | "small";

export interface ExportOptions {
  format: ExportFormat;
  resolution: ExportResolution;
  fps: ExportFps;
  quality: ExportQuality;
}

export interface ExportProgress {
  phase: "preparing" | "rendering" | "finalizing" | "done" | "error" | "cancelled";
  progress: number; // 0..1
  currentFrame: number;
  totalFrames: number;
  etaSeconds: number | null;
  message: string;
}

export interface AlertBannerItem {
  id: string;
  severity: "info" | "warning" | "error" | "success";
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}
