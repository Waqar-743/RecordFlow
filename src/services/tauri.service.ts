import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  AudioDeviceInfo,
  CameraInfo,
  DisplayInfo,
  HotkeyApplyResult,
  HotkeyConfig,
  RecordingInfo,
  RecordingSettings,
  RecordingStatus,
  TimerSession,
  WindowInfo,
} from "../types";

export const isTauriApp = () => !!(window as any).__TAURI_INTERNALS__;

export const DEFAULT_HOTKEYS: HotkeyConfig = {
  toggle_recording: "Alt+Shift+R",
  toggle_pause: "Alt+Shift+P",
};

// Mock state for browser development & UI verification
let mockSettings: RecordingSettings = {
  screen_enabled: true,
  capture_mode: "Screen",
  resolution: "1080p",
  fps: 60,
  bitrate: 8000,
  capture_cursor: true,
  selected_display: 0,
  selected_window: null,
  capture_region: null,
  selected_camera: "0",
  camera_enabled: false,
  camera_position: "BottomRight",
  camera_size: "Medium",
  camera_shape: "Rounded",
  camera_mirror: true,
  microphone_device: "Default Microphone",
  mic_enabled: true,
  mic_volume: 0.85,
  system_audio_device: "Speakers (Realtek High Definition Audio)",
  system_audio_enabled: true,
  system_audio_volume: 0.75,
  countdown_seconds: 0,
  auto_minimize: false,
};

let mockHotkeys: HotkeyConfig = { ...DEFAULT_HOTKEYS };
let mockCloseToTray = true;

let mockStatus: RecordingStatus = {
  is_recording: false,
  is_paused: false,
  output_file: null,
  elapsed_seconds: 0,
};

let mockHistory: TimerSession[] = [];
let mockTimerId: number | null = null;

function createMockThumbnailBytes(displayIndex: number): number[] {
  if (typeof document === "undefined") return [];
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 270;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const grad = ctx.createLinearGradient(0, 0, 480, 270);
  if (displayIndex === 0) {
    grad.addColorStop(0, "#1e1b4b");
    grad.addColorStop(0.55, "#0f172a");
    grad.addColorStop(1, "#09090b");
  } else {
    grad.addColorStop(0, "#064e3b");
    grad.addColorStop(0.55, "#0f172a");
    grad.addColorStop(1, "#09090b");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 480, 270);

  ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(44, 34, 392, 188, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.font = "600 16px Inter, sans-serif";
  ctx.fillText(displayIndex === 0 ? "Display 1 (Primary)" : `Display ${displayIndex + 1}`, 66, 72);
  ctx.fillStyle = "rgba(161, 161, 170, 0.9)";
  ctx.font = "12px monospace";
  ctx.fillText(
    displayIndex === 0 ? "1920 × 1080 · Live Preview" : "2560 × 1440 · Secondary",
    66,
    94,
  );

  ctx.fillStyle = "rgba(9, 9, 11, 0.75)";
  ctx.fillRect(0, 246, 480, 24);

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const bytes = new Array<number>(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function invoke<T>(cmd: string, args?: any): Promise<T> {
  if (!isTauriApp()) {
    if (cmd === "get_settings") return { ...mockSettings } as unknown as T;
    if (cmd === "update_settings") {
      mockSettings = { ...mockSettings, ...args.settings };
      return undefined as unknown as T;
    }
    if (cmd === "get_recording_status") return { ...mockStatus } as unknown as T;

    if (cmd === "start_recording") {
      mockStatus = {
        ...mockStatus,
        is_recording: true,
        is_paused: false,
        output_file: "Documents/RecordFlow/Recordings/recording_preview.mp4",
        elapsed_seconds: 0,
      };
      if (mockTimerId) window.clearInterval(mockTimerId);
      mockTimerId = window.setInterval(() => {
        if (mockStatus.is_recording && !mockStatus.is_paused) {
          mockStatus.elapsed_seconds++;
        }
      }, 1000);
      return mockStatus.output_file as unknown as T;
    }

    if (cmd === "stop_recording") {
      const elapsed = mockStatus.elapsed_seconds;
      mockStatus = { ...mockStatus, is_recording: false, is_paused: false };
      if (mockTimerId) window.clearInterval(mockTimerId);

      mockHistory = [
        {
          id: String(Date.now()),
          started_at: new Date(Date.now() - elapsed * 1000).toISOString(),
          ended_at: new Date().toISOString(),
          duration_seconds: elapsed,
          status: "completed",
          output_file: mockStatus.output_file,
        },
        ...mockHistory,
      ];
      return { ...mockStatus } as unknown as T;
    }

    if (cmd === "pause_recording") {
      mockStatus = { ...mockStatus, is_paused: true };
      return "paused" as unknown as T;
    }

    if (cmd === "resume_recording") {
      mockStatus = { ...mockStatus, is_paused: false };
      return "resumed" as unknown as T;
    }

    if (cmd === "get_displays") {
      return [
        { index: 0, name: "Display 1 (Primary)", width: 1920, height: 1080, x: 0, y: 0, is_primary: true },
        { index: 1, name: "Display 2", width: 2560, height: 1440, x: 1920, y: 0, is_primary: false },
      ] as unknown as T;
    }

    if (cmd === "get_display_thumbnail") {
      return createMockThumbnailBytes(args?.displayIndex ?? 0) as unknown as T;
    }

    if (cmd === "get_capture_windows") {
      return [
        { id: "window:1001", title: "Visual Studio Code — RecordFlow", process: "Code", width: 1600, height: 960 },
        { id: "window:1002", title: "Google Chrome — Product Demo", process: "chrome", width: 1440, height: 900 },
        { id: "window:1003", title: "Windows Terminal", process: "WindowsTerminal", width: 1200, height: 760 },
      ] as unknown as T;
    }

    if (cmd === "get_cameras") {
      return [{ index: 0, name: "Integrated HD Webcam", width: 1280, height: 720 }] as unknown as T;
    }
    if (cmd === "get_audio_inputs") {
      return [
        { index: 0, name: "Default Microphone", channels: 2, sample_rate: 48000, is_input: true },
        { index: 1, name: "USB Condenser Mic", channels: 1, sample_rate: 44100, is_input: true },
      ] as unknown as T;
    }
    if (cmd === "get_system_audio_devices") {
      return [
        { index: 0, name: "Speakers (Realtek High Definition Audio)", channels: 2, sample_rate: 48000, is_input: false },
        { index: 1, name: "Headphones (USB Audio)", channels: 2, sample_rate: 48000, is_input: false },
      ] as unknown as T;
    }

    if (cmd === "get_last_recording_info") {
      return {
        file_path: mockStatus.output_file ?? "recording_preview.mp4",
        file_name: "recording_preview.mp4",
        file_size: 14_800_000,
        duration: mockStatus.elapsed_seconds,
        created_at: new Date().toISOString(),
      } as unknown as T;
    }

    if (cmd === "get_timer_history") return mockHistory as unknown as T;
    if (cmd === "delete_timer_session") {
      mockHistory = mockHistory.filter((s) => s.id !== args.id);
      return mockHistory as unknown as T;
    }
    if (cmd === "clear_timer_history") {
      mockHistory = [];
      return undefined as unknown as T;
    }

    if (cmd === "get_hotkeys") return { ...mockHotkeys } as unknown as T;
    if (cmd === "set_hotkeys") {
      mockHotkeys = { ...args.hotkeys };
      return {
        hotkeys: { ...mockHotkeys },
        registered: Object.values(mockHotkeys).filter(Boolean),
        failed: [],
      } as unknown as T;
    }
    if (cmd === "get_close_to_tray") return mockCloseToTray as unknown as T;
    if (cmd === "set_close_to_tray") {
      mockCloseToTray = Boolean(args?.enabled);
      return undefined as unknown as T;
    }

    return undefined as unknown as T;
  }

  const isRecordingCommand = cmd === "start_recording" || cmd === "stop_recording";
  const timeoutMs = isRecordingCommand ? 30_000 : 10_000;

  try {
    return await Promise.race([
      tauriInvoke<T>(cmd, args),
      new Promise<T>((_, reject) =>
        window.setTimeout(
          () => reject(new Error(`Tauri IPC timed out after ${timeoutMs}ms (command: ${cmd})`)),
          timeoutMs,
        ),
      ),
    ]);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "message" in error) {
      throw error;
    }
    if (error && typeof error === "object" && "code" in error) {
      const e = error as { code: string; message: string; details?: string };
      throw new Error(e.details ? `${e.message}: ${e.details}` : e.message);
    }
    throw new Error(String(error));
  }
}

export const tauriService = {
  // Settings
  getSettings: () => invoke<RecordingSettings>("get_settings"),
  updateSettings: (settings: RecordingSettings) => invoke<void>("update_settings", { settings }),

  // Devices & Capture Sources
  getDisplays: () => invoke<DisplayInfo[]>("get_displays"),
  getDisplayThumbnail: (displayIndex: number) =>
    invoke<number[]>("get_display_thumbnail", { displayIndex }),
  getCaptureWindows: () => invoke<WindowInfo[]>("get_capture_windows"),
  getCameras: () => invoke<CameraInfo[]>("get_cameras"),
  getAudioInputs: () => invoke<AudioDeviceInfo[]>("get_audio_inputs"),
  getSystemAudioDevices: () => invoke<AudioDeviceInfo[]>("get_system_audio_devices"),

  // Recording
  startRecording: () => invoke<string>("start_recording"),
  stopRecording: () => invoke<RecordingStatus>("stop_recording"),
  pauseRecording: () => invoke<string>("pause_recording"),
  resumeRecording: () => invoke<string>("resume_recording"),
  getRecordingStatus: () => invoke<RecordingStatus>("get_recording_status"),

  // Files
  getLastRecordingInfo: () => invoke<RecordingInfo>("get_last_recording_info"),
  openRecordingInExplorer: (path: string) =>
    invoke<void>("open_recording_in_explorer", { path }),
  deleteRecording: (path: string) => invoke<void>("delete_recording", { path }),
  openRecordingsFolder: () => invoke<void>("open_recordings_folder"),

  // History
  getTimerHistory: () => invoke<TimerSession[]>("get_timer_history"),
  deleteTimerSession: (id: string) => invoke<TimerSession[]>("delete_timer_session", { id }),
  clearTimerHistory: () => invoke<void>("clear_timer_history"),

  // Hotkeys & Tray / Window
  getHotkeys: () => invoke<HotkeyConfig>("get_hotkeys"),
  setHotkeys: (hotkeys: HotkeyConfig) => invoke<HotkeyApplyResult>("set_hotkeys", { hotkeys }),
  setTrayState: (recording: boolean, paused = false, shortcut?: string) =>
    invoke<void>("set_tray_state", { recording, paused, shortcut: shortcut ?? null }),
  getCloseToTray: () => invoke<boolean>("get_close_to_tray"),
  setCloseToTray: (enabled: boolean) => invoke<void>("set_close_to_tray", { enabled }),
  minimizeMainWindow: () => invoke<void>("minimize_main_window"),
  restoreMainWindow: () => invoke<void>("restore_main_window"),
};
