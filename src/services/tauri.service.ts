import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  AudioDeviceInfo,
  CameraInfo,
  DisplayInfo,
  TimerSession,
  RecordingInfo,
  RecordingSettings,
  RecordingStatus,
} from "../types";

// Helper to check if running in Tauri
export const isTauriApp = () => !!(window as any).__TAURI_INTERNALS__;

// Mock state for browser development
let mockSettings: RecordingSettings = {
  screen_enabled: true,
  resolution: "1080p",
  fps: 30,
  bitrate: 5000,
  selected_display: 0,
  selected_window: null,
  capture_region: null,
  selected_camera: null,
  camera_enabled: false,
  camera_position: "BottomRight",
  camera_size: "Medium",
  microphone_device: "Default",
  mic_enabled: true,
  mic_volume: 0.8,
  system_audio_device: "Default",
  system_audio_enabled: false,
  system_audio_volume: 0.6,
};

let mockStatus: RecordingStatus = {
  is_recording: false,
  is_paused: false,
  output_file: null,
  elapsed_seconds: 0,
};

let mockHistory: TimerSession[] = [];

let mockTimerId: number | null = null;

async function invoke<T>(cmd: string, args?: any): Promise<T> {
  if (!isTauriApp()) {
    console.warn(`Browser mode: MOCKING "${cmd}"`, args);
    
    if (cmd === "get_settings") return mockSettings as unknown as T;
    if (cmd === "update_settings") {
      mockSettings = { ...mockSettings, ...args.settings };
      return undefined as unknown as T;
    }
    if (cmd === "get_recording_status") return mockStatus as unknown as T;
    
    if (cmd === "start_recording") {
      mockStatus = { ...mockStatus, is_recording: true, elapsed_seconds: 0 };
      if (mockTimerId) window.clearInterval(mockTimerId);
      mockTimerId = window.setInterval(() => {
        if (mockStatus.is_recording && !mockStatus.is_paused) {
          mockStatus.elapsed_seconds++;
        }
      }, 1000);
      return "mock_output.mp4" as unknown as T;
    }
    
    if (cmd === "stop_recording") {
      mockStatus = { ...mockStatus, is_recording: false, is_paused: false };
      if (mockTimerId) window.clearInterval(mockTimerId);

      mockHistory = [
        {
          id: String(Date.now()),
          started_at: new Date(Date.now() - mockStatus.elapsed_seconds * 1000).toISOString(),
          ended_at: new Date().toISOString(),
          duration_seconds: mockStatus.elapsed_seconds,
          status: "completed",
          output_file: "mock_output.mp4",
        },
        ...mockHistory,
      ];

      return mockStatus as unknown as T;
    }

    if (cmd === "pause_recording") {
      mockStatus = { ...mockStatus, is_paused: true };
      return "paused" as unknown as T;
    }

    if (cmd === "resume_recording") {
      mockStatus = { ...mockStatus, is_paused: false };
      return "resumed" as unknown as T;
    }

    if (cmd === "get_displays") return [{ index: 0, name: "Main Monitor", width: 1920, height: 1080, x: 0, y: 0, is_primary: true }] as unknown as T;
    if (cmd === "get_cameras") return [{ index: 0, name: "FaceTime HD Camera", width: 1280, height: 720 }] as unknown as T;
    if (cmd === "get_audio_inputs") return [{ index: 0, name: "Internal Mic", channels: 2, sample_rate: 48000, is_input: true }] as unknown as T;
    if (cmd === "get_system_audio_devices") return [{ index: 0, name: "Speakers", channels: 2, sample_rate: 48000, is_input: false }] as unknown as T;

    if (cmd === "get_timer_history") return mockHistory as unknown as T;
    if (cmd === "delete_timer_session") {
      mockHistory = mockHistory.filter((s) => s.id !== args.id);
      return mockHistory as unknown as T;
    }
    if (cmd === "clear_timer_history") {
      mockHistory = [];
      return undefined as unknown as T;
    }
    
    return undefined as unknown as T;
  }

  // Recording operations can take time (device initialization, encoder setup)
  // Use longer timeout for recording commands, shorter for quick queries
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
    // Format error for better display
    if (error && typeof error === 'object' && 'message' in error) {
      throw error;
    }
    // Handle Tauri's error format (object with code/message/details)
    if (error && typeof error === 'object' && 'code' in error) {
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

  // Devices
  getDisplays: () => invoke<DisplayInfo[]>("get_displays"),
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
};

