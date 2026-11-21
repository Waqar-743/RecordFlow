import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { exists, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  AudioDeviceInfo,
  CameraInfo,
  CursorTrackData,
  DisplayInfo,
  EditorProject,
  HotkeyApplyFailure,
  HotkeyApplyResult,
  HotkeyConfig,
  RecordingInfo,
  RecordingSettings,
  RecordingStatus,
  TimerSession,
  WindowInfo,
} from "../types";

export const isTauriApp = () =>
  typeof window !== "undefined" && Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__);

export const DEFAULT_HOTKEYS: HotkeyConfig = {
  toggle_recording: "Ctrl+Alt+Shift+R",
  toggle_pause: "Ctrl+Alt+Shift+P",
};

// Mock state for browser preview & development
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
  countdown_seconds: 3,
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

let mockSaveFolder = "Videos/RecordFlow/Recordings";
let mockHistory: TimerSession[] = [];
let mockTimerId: number | null = null;

function createMockScreenThumbnail(
  title: string,
  subtitle: string,
  accentA: string,
  accentB: string,
  width = 640,
  height = 360,
): number[] {
  if (typeof document === "undefined") return [];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  // Warm wallpaper gradient (strictly zero blue/green)
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, accentA);
  grad.addColorStop(0.55, "#1a1312");
  grad.addColorStop(1, accentB);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle decorative warm glow
  const glow = ctx.createRadialGradient(width * 0.72, height * 0.25, 10, width * 0.72, height * 0.25, width * 0.45);
  glow.addColorStop(0, "rgba(255, 107, 74, 0.28)");
  glow.addColorStop(1, "rgba(255, 107, 74, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Mock desktop app window
  const padX = Math.round(width * 0.08);
  const padY = Math.round(height * 0.11);
  const winW = width - padX * 2;
  const winH = height - padY * 2 - 18;
  ctx.fillStyle = "rgba(22, 16, 16, 0.88)";
  ctx.strokeStyle = "rgba(255, 235, 225, 0.15)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(padX, padY, winW, winH, 12);
  ctx.fill();
  ctx.stroke();

  // Window chrome bar
  ctx.fillStyle = "rgba(255, 240, 230, 0.05)";
  ctx.beginPath();
  ctx.roundRect(padX, padY, winW, 28, [12, 12, 0, 0]);
  ctx.fill();

  const dotColors = ["#ff5f57", "#f59e0b", "#f4729b"];
  dotColors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(padX + 16 + i * 14, padY + 14, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Sidebar + content blocks
  ctx.fillStyle = "rgba(255, 240, 230, 0.035)";
  ctx.fillRect(padX + 1, padY + 29, Math.round(winW * 0.22), winH - 30);

  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i === 1 ? "rgba(255, 107, 74, 0.24)" : "rgba(255, 240, 230, 0.08)";
    ctx.beginPath();
    ctx.roundRect(padX + 12, padY + 44 + i * 24, Math.round(winW * 0.16), 12, 4);
    ctx.fill();
  }

  const contentX = padX + Math.round(winW * 0.26);
  ctx.fillStyle = "rgba(255, 248, 244, 0.92)";
  ctx.font = "600 17px Inter, system-ui, sans-serif";
  ctx.fillText(title, contentX, padY + 62);

  ctx.fillStyle = "rgba(255, 146, 115, 0.9)";
  ctx.font = "500 12px 'JetBrains Mono', monospace";
  ctx.fillText(subtitle, contentX, padY + 84);

  // Metric cards inside mock app
  const cardW = Math.round((winW * 0.68 - 20) / 3);
  for (let i = 0; i < 3; i++) {
    const cx = contentX + i * (cardW + 10);
    const cy = padY + 104;
    ctx.fillStyle = "rgba(255, 240, 230, 0.05)";
    ctx.strokeStyle = "rgba(255, 240, 230, 0.1)";
    ctx.beginPath();
    ctx.roundRect(cx, cy, cardW, 62, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = i === 1 ? "rgba(245, 158, 11, 0.78)" : "rgba(255, 107, 74, 0.75)";
    ctx.beginPath();
    ctx.roundRect(cx + 12, cy + 16, cardW * 0.55, 8, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 240, 230, 0.22)";
    ctx.beginPath();
    ctx.roundRect(cx + 12, cy + 34, cardW * 0.75, 10, 4);
    ctx.fill();
  }

  // Taskbar
  ctx.fillStyle = "rgba(12, 9, 9, 0.85)";
  ctx.fillRect(0, height - 24, width, 24);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i === 2 ? "#ff6b4a" : "rgba(255, 240, 230, 0.22)";
    ctx.beginPath();
    ctx.roundRect(width / 2 - 46 + i * 20, height - 18, 12, 12, 3);
    ctx.fill();
  }

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const bytes = new Array<number>(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

const MOCK_WINDOWS: WindowInfo[] = [
  { id: "window:1001", title: "Visual Studio Code — RecordFlow", process: "Code", width: 1600, height: 960 },
  { id: "window:1002", title: "Google Chrome — Product Walkthrough", process: "chrome", width: 1440, height: 900 },
  { id: "window:1003", title: "Figma — RecordFlow Design System", process: "Figma", width: 1512, height: 945 },
  { id: "window:1004", title: "Windows Terminal — PowerShell", process: "WindowsTerminal", width: 1200, height: 760 },
  { id: "window:1005", title: "Notion — Q4 Launch Spec", process: "Notion", width: 1360, height: 860 },
];

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriApp()) {
    if (cmd === "get_settings") return { ...mockSettings } as unknown as T;
    if (cmd === "update_settings") {
      mockSettings = { ...mockSettings, ...(args?.settings as RecordingSettings) };
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
        { index: 1, name: "Display 2 — Studio Pro", width: 2560, height: 1440, x: 1920, y: 0, is_primary: false },
      ] as unknown as T;
    }

    if (cmd === "get_display_thumbnail") {
      const idx = Number(args?.displayIndex ?? 0);
      const w = Math.min(960, Number(args?.maxWidth ?? 720));
      const h = Math.round((w * 9) / 16);
      return createMockScreenThumbnail(
        idx === 0 ? "Display 1 (Primary)" : `Display ${idx + 1} — Studio Pro`,
        idx === 0 ? "1920 × 1080 · Active Desktop" : "2560 × 1440 · Extended Display",
        idx === 0 ? "#2e1216" : "#2b160e",
        idx === 0 ? "#140b0d" : "#160d09",
        w,
        h,
      ) as unknown as T;
    }

    if (cmd === "get_window_thumbnail") {
      const id = String(args?.windowId ?? "");
      const win = MOCK_WINDOWS.find((w) => w.id === id) ?? MOCK_WINDOWS[0];
      const maxW = Math.min(800, Number(args?.maxWidth ?? 640));
      const h = Math.max(180, Math.round((maxW * win.height) / Math.max(1, win.width)));
      return createMockScreenThumbnail(
        win.title,
        `${win.process}.exe · ${win.width} × ${win.height}`,
        "#2a141d",
        "#130b0e",
        maxW,
        h,
      ) as unknown as T;
    }

    if (cmd === "get_recordings_folder") {
      return mockSaveFolder as unknown as T;
    }

    if (cmd === "set_recordings_folder") {
      if (typeof args?.path === "string" && args.path.trim()) {
        mockSaveFolder = args.path.trim();
      }
      return mockSaveFolder as unknown as T;
    }

    if (cmd === "get_capture_windows") {
      return [...MOCK_WINDOWS] as unknown as T;
    }

    if (cmd === "get_cameras") {
      return [{ index: 0, name: "Integrated HD Webcam", width: 1280, height: 720 }] as unknown as T;
    }

    if (cmd === "get_audio_inputs") {
      return [
        { index: 0, name: "Default Microphone", channels: 2, sample_rate: 48000, is_input: true },
        { index: 1, name: "USB Studio Condenser Mic", channels: 1, sample_rate: 48000, is_input: true },
      ] as unknown as T;
    }

    if (cmd === "get_system_audio_devices") {
      return [
        { index: 0, name: "Speakers (Realtek High Definition Audio)", channels: 2, sample_rate: 48000, is_input: false },
        { index: 1, name: "Studio Headphones (USB DAC)", channels: 2, sample_rate: 48000, is_input: false },
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
      mockHistory = mockHistory.filter((s) => s.id !== args?.id);
      return mockHistory as unknown as T;
    }
    if (cmd === "clear_timer_history") {
      mockHistory = [];
      return undefined as unknown as T;
    }

    if (cmd === "get_hotkeys") return { ...mockHotkeys } as unknown as T;
    if (cmd === "get_hotkey_failures") return [] as unknown as T;
    if (cmd === "set_hotkeys") {
      mockHotkeys = { ...(args?.hotkeys as HotkeyConfig) };
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

/** Convert a local file path to a webview-playable asset URL. */
export function localPathToUrl(filePath: string): string {
  if (!isTauriApp()) return filePath;
  return convertFileSrc(filePath);
}

/** Companion sidecar path helpers matching Rust backend conventions. */
export function getCameraSidecarPath(mp4Path: string): string {
  if (/\.mp4$/i.test(mp4Path)) return mp4Path.replace(/\.mp4$/i, ".cam.mp4");
  return `${mp4Path}.cam.mp4`;
}

export function getCursorSidecarPath(mp4Path: string): string {
  if (/\.mp4$/i.test(mp4Path)) return mp4Path.replace(/\.mp4$/i, ".cursor.json");
  return `${mp4Path}.cursor.json`;
}

/** Check and read companion sidecars (.cam.mp4 & .cursor.json) for a native recording. */
export async function loadNativeSidecars(mp4Path: string): Promise<{
  cameraUrl: string | null;
  cameraPath: string | null;
  cursorTrack: CursorTrackData | null;
}> {
  if (!isTauriApp()) {
    return { cameraUrl: null, cameraPath: null, cursorTrack: null };
  }

  let cameraUrl: string | null = null;
  let cameraPath: string | null = null;
  let cursorTrack: CursorTrackData | null = null;

  try {
    const camPath = getCameraSidecarPath(mp4Path);
    if (await exists(camPath)) {
      cameraPath = camPath;
      cameraUrl = convertFileSrc(camPath);
    }
  } catch {
    /* optional sidecar */
  }

  try {
    const cursorPath = getCursorSidecarPath(mp4Path);
    if (await exists(cursorPath)) {
      const raw = await readTextFile(cursorPath);
      const parsed = JSON.parse(raw) as CursorTrackData;
      if (parsed && Array.isArray(parsed.samples)) {
        cursorTrack = parsed;
      }
    }
  } catch {
    /* optional sidecar */
  }

  return { cameraUrl, cameraPath, cursorTrack };
}

/** Save an exported video Blob to disk (native Save dialog in Tauri, download in browser). */
export async function saveExportedVideoFile(
  blob: Blob,
  suggestedName: string,
  format: "mp4" | "webm",
): Promise<{ saved: boolean; filePath: string | null }> {
  if (isTauriApp()) {
    const path = await saveDialog({
      title: "Save Exported Video",
      defaultPath: suggestedName,
      filters: [
        format === "mp4"
          ? { name: "MP4 Video", extensions: ["mp4"] }
          : { name: "WebM Video", extensions: ["webm"] },
      ],
    });
    if (!path) return { saved: false, filePath: null };
    const buffer = new Uint8Array(await blob.arrayBuffer());
    await writeFile(path, buffer);
    return { saved: true, filePath: path };
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { saved: true, filePath: suggestedName };
}

/** Save an EditorProject JSON file (.rfproj.json). */
export async function saveProjectToFile(project: EditorProject): Promise<{ saved: boolean; path: string | null }> {
  const serializable: EditorProject = {
    ...project,
    // Keep file paths; strip ephemeral blob URLs only if native paths exist
    screenUrl: project.screenPath ? "" : project.screenUrl,
    cameraUrl: project.cameraPath ? null : project.cameraUrl,
  };
  const json = JSON.stringify(serializable, null, 2);
  const defaultName = `${project.name.replace(/[^a-z0-9-_]+/gi, "_")}.rfproj.json`;

  if (isTauriApp()) {
    const path = await saveDialog({
      title: "Save RecordFlow Project",
      defaultPath: defaultName,
      filters: [{ name: "RecordFlow Project", extensions: ["rfproj.json", "json"] }],
    });
    if (!path) return { saved: false, path: null };
    await writeTextFile(path, json);
    return { saved: true, path };
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  return { saved: true, path: defaultName };
}

/** Open either a RecordFlow project (.rfproj.json) OR a local video file (.mp4/.webm/.mov). */
export async function openProjectOrVideoFile(): Promise<
  | { kind: "project"; project: EditorProject; fileName: string }
  | { kind: "video"; url: string; path: string | null; fileName: string }
  | null
> {
  if (isTauriApp()) {
    const selected = await openDialog({
      title: "Open Project or Recording",
      multiple: false,
      filters: [
        { name: "RecordFlow Projects & Videos", extensions: ["json", "mp4", "webm", "mov", "mkv"] },
      ],
    });
    if (!selected || Array.isArray(selected)) return null;
    const filePath = selected;
    const fileName = filePath.split(/[\\/]/).pop() ?? "Recording";

    if (/\.json$/i.test(filePath)) {
      const text = await readTextFile(filePath);
      const parsed = JSON.parse(text) as EditorProject;
      const hydrated: EditorProject = {
        ...parsed,
        screenUrl: parsed.screenPath ? convertFileSrc(parsed.screenPath) : parsed.screenUrl,
        cameraUrl: parsed.cameraPath ? convertFileSrc(parsed.cameraPath) : parsed.cameraUrl,
      };
      return { kind: "project", project: hydrated, fileName };
    }

    return {
      kind: "video",
      url: convertFileSrc(filePath),
      path: filePath,
      fileName,
    };
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.rfproj.json,video/mp4,video/webm,video/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      if (file.name.toLowerCase().endsWith(".json")) {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text) as EditorProject;
          resolve({ kind: "project", project: parsed, fileName: file.name });
        } catch {
          resolve(null);
        }
        return;
      }
      resolve({
        kind: "video",
        url: URL.createObjectURL(file),
        path: null,
        fileName: file.name,
      });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const tauriService = {
  getSettings: () => invoke<RecordingSettings>("get_settings"),
  updateSettings: (settings: RecordingSettings) => invoke<void>("update_settings", { settings }),

  getDisplays: () => invoke<DisplayInfo[]>("get_displays"),
  getDisplayThumbnail: (displayIndex: number, maxWidth = 720) =>
    invoke<number[]>("get_display_thumbnail", { displayIndex, maxWidth }),
  getWindowThumbnail: (windowId: string, maxWidth = 640) =>
    invoke<number[]>("get_window_thumbnail", { windowId, maxWidth }),
  getCaptureWindows: () => invoke<WindowInfo[]>("get_capture_windows"),
  getCameras: () => invoke<CameraInfo[]>("get_cameras"),
  getAudioInputs: () => invoke<AudioDeviceInfo[]>("get_audio_inputs"),
  getSystemAudioDevices: () => invoke<AudioDeviceInfo[]>("get_system_audio_devices"),

  startRecording: () => invoke<string>("start_recording"),
  stopRecording: () => invoke<RecordingStatus>("stop_recording"),
  pauseRecording: () => invoke<string>("pause_recording"),
  resumeRecording: () => invoke<string>("resume_recording"),
  getRecordingStatus: () => invoke<RecordingStatus>("get_recording_status"),

  getLastRecordingInfo: () => invoke<RecordingInfo>("get_last_recording_info"),
  getRecordingsFolder: () => invoke<string>("get_recordings_folder"),
  setRecordingsFolder: (path: string) => invoke<string>("set_recordings_folder", { path }),
  pickRecordingsFolder: async (currentPath?: string): Promise<string | null> => {
    if (isTauriApp()) {
      const picked = await openDialog({
        title: "Choose Recordings Save Folder",
        directory: true,
        multiple: false,
        defaultPath: currentPath || undefined,
      });
      if (!picked || Array.isArray(picked)) return null;
      return invoke<string>("set_recordings_folder", { path: picked });
    }
    const next = window.prompt("Enter recordings folder path:", currentPath || mockSaveFolder);
    if (!next || !next.trim()) return null;
    mockSaveFolder = next.trim();
    return mockSaveFolder;
  },
  openRecordingInExplorer: (path: string) => invoke<void>("open_recording_in_explorer", { path }),
  deleteRecording: (path: string) => invoke<void>("delete_recording", { path }),
  openRecordingsFolder: () => invoke<void>("open_recordings_folder"),

  getTimerHistory: () => invoke<TimerSession[]>("get_timer_history"),
  deleteTimerSession: (id: string) => invoke<TimerSession[]>("delete_timer_session", { id }),
  clearTimerHistory: () => invoke<void>("clear_timer_history"),

  getHotkeys: () => invoke<HotkeyConfig>("get_hotkeys"),
  getHotkeyFailures: () => invoke<HotkeyApplyFailure[]>("get_hotkey_failures"),
  setHotkeys: (hotkeys: HotkeyConfig) => invoke<HotkeyApplyResult>("set_hotkeys", { hotkeys }),
  setTrayState: (recording: boolean, paused = false, shortcut?: string) =>
    invoke<void>("set_tray_state", { recording, paused, shortcut: shortcut ?? null }),
  getCloseToTray: () => invoke<boolean>("get_close_to_tray"),
  setCloseToTray: (enabled: boolean) => invoke<void>("set_close_to_tray", { enabled }),
  minimizeMainWindow: () => invoke<void>("minimize_main_window"),
  restoreMainWindow: () => invoke<void>("restore_main_window"),
};
