import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioSettings } from "../components/AudioSettings";
import { CameraSettings } from "../components/CameraSettings";
import { CaptureSourceSection } from "../components/CaptureSourceSection";
import { CountdownOverlay } from "../components/CountdownOverlay";
import { HotkeyModal } from "../components/HotkeyModal";
import { DownloadIcon, FileTextIcon, KeyboardIcon } from "../components/Icons";
import { ScreenRegionPicker, type AreaPickRequest } from "../components/ScreenRegionPicker";
import { Sidebar } from "../components/Sidebar";
import { TeleprompterWindow } from "../components/TeleprompterWindow";
import { UpdateBanner } from "../components/UpdateBanner";
import { VideoSettings } from "../components/VideoSettings";
import { useRecording } from "../hooks/useRecording";
import { useSettings } from "../hooks/useSettings";
import { useTimerHistory } from "../hooks/useTimerHistory";
import { DEFAULT_HOTKEYS, isTauriApp, tauriService } from "../services/tauri.service";
import type {
  CameraPosition,
  CameraShape,
  CameraSize,
  CaptureMode,
  CaptureRegion,
  DisplayInfo,
  HotkeyConfig,
  RecordingInfo,
  Resolution,
  WindowInfo,
} from "../types";
import { APP_VERSION } from "../utils/updates";

const TELEPROMPTER_WINDOW_LABEL = "teleprompter";

export function RecorderPage() {
  const { settings, loading: settingsLoading, error: settingsError, updateSettings } = useSettings();
  const recording = useRecording();
  const history = useTimerHistory();

  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [displayThumbnails, setDisplayThumbnails] = useState<Record<number, string>>({});
  const [thumbnailsLoading, setThumbnailsLoading] = useState(false);
  const thumbnailUrlsRef = useRef<string[]>([]);

  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [windowsLoading, setWindowsLoading] = useState(false);

  const [lastInfo, setLastInfo] = useState<RecordingInfo | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pickRequest, setPickRequest] = useState<AreaPickRequest | null>(null);

  // Phase 2 & 3 workflow states
  const [hotkeys, setHotkeys] = useState<HotkeyConfig>(DEFAULT_HOTKEYS);
  const [isHotkeyModalOpen, setIsHotkeyModalOpen] = useState(false);
  const [activeCountdown, setActiveCountdown] = useState(0);
  const countdownTimerRef = useRef<number | null>(null);
  const [isTeleprompterOpen, setIsTeleprompterOpen] = useState(false);
  const [updateCheckToken, setUpdateCheckToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);

  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setActiveCountdown(0);
  }, []);

  const refreshThumbnails = useCallback(async (displayList: DisplayInfo[]) => {
    if (displayList.length === 0) return;
    setThumbnailsLoading(true);
    try {
      const results = await Promise.allSettled(
        displayList.map(async (d) => {
          const bytes = await tauriService.getDisplayThumbnail(d.index);
          const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
          return [d.index, URL.createObjectURL(blob)] as const;
        }),
      );

      const nextUrls: string[] = [];
      const nextMap: Record<number, string> = {};
      for (const r of results) {
        if (r.status === "fulfilled") {
          const [idx, url] = r.value;
          nextMap[idx] = url;
          nextUrls.push(url);
        }
      }

      for (const oldUrl of thumbnailUrlsRef.current) {
        URL.revokeObjectURL(oldUrl);
      }
      thumbnailUrlsRef.current = nextUrls;
      setDisplayThumbnails(nextMap);
    } finally {
      setThumbnailsLoading(false);
    }
  }, []);

  const refreshWindows = useCallback(async () => {
    setWindowsLoading(true);
    try {
      const list = await tauriService.getCaptureWindows();
      setWindows(list);
      return list;
    } catch {
      setWindows([]);
      return [];
    } finally {
      setWindowsLoading(false);
    }
  }, []);

  // Load displays, thumbnails & hotkeys on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await tauriService.getDisplays();
        if (cancelled) return;
        setDisplays(list);
        setDisplayError(null);
        void refreshThumbnails(list);
      } catch (e) {
        if (cancelled) return;
        setDisplayError(String(e));
        setDisplays([]);
      }
    })();

    void tauriService
      .getHotkeys()
      .then((cfg) => {
        if (!cancelled && cfg) setHotkeys({ ...DEFAULT_HOTKEYS, ...cfg });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      cancelCountdown();
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      for (const url of thumbnailUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      thumbnailUrlsRef.current = [];
    };
  }, [cancelCountdown, refreshThumbnails]);

  // Refresh open windows whenever entering Window mode
  useEffect(() => {
    if (settings?.capture_mode === "Window") {
      void refreshWindows();
    }
  }, [refreshWindows, settings?.capture_mode]);

  // Refresh last recording info + history when a recording stops
  useEffect(() => {
    if (!recording.status.is_recording && recording.status.output_file) {
      void (async () => {
        try {
          setFileError(null);
          const info = await tauriService.getLastRecordingInfo();
          setLastInfo(info);
        } catch (e) {
          setFileError(String(e));
        }
      })();
      void history.refresh();
    }
  }, [history.refresh, recording.status.is_recording, recording.status.output_file]);

  const activeDisplay = useMemo(() => {
    if (!settings) return null;
    return displays.find((d) => d.index === settings.selected_display) ?? displays[0] ?? null;
  }, [displays, settings]);

  const activeWindow = useMemo(() => {
    if (!settings?.selected_window) return null;
    return windows.find((w) => w.id === settings.selected_window) ?? null;
  }, [settings?.selected_window, windows]);

  const canStart = useMemo(() => {
    if (!settings) return false;
    if (settings.capture_mode === "Window") {
      return Boolean(settings.selected_window && activeWindow);
    }
    return displays.length > 0;
  }, [activeWindow, displays.length, settings]);

  const startHint = useMemo(() => {
    if (!settings) return null;
    if (settings.capture_mode === "Window" && !activeWindow) {
      return "Select an open window above to enable recording.";
    }
    if (settings.capture_mode === "Area" && !settings.capture_region) {
      return "Clicking Start will let you draw your capture area first.";
    }
    return null;
  }, [activeWindow, settings]);

  const summaryChips = useMemo(() => {
    if (!settings) return [];
    const chips: string[] = [];
    chips.push(
      settings.capture_mode === "Screen"
        ? "Full Screen"
        : settings.capture_mode === "Area"
          ? settings.capture_region
            ? `Area ${settings.capture_region.width}×${settings.capture_region.height}`
            : "Area"
          : "Window",
    );
    chips.push(`${settings.resolution} · ${settings.fps}fps`);
    if (settings.mic_enabled && settings.system_audio_enabled) {
      chips.push("Mic + System");
    } else if (settings.mic_enabled) {
      chips.push("Mic");
    } else if (settings.system_audio_enabled) {
      chips.push("System Audio");
    } else {
      chips.push("Muted");
    }
    if (settings.camera_enabled) {
      chips.push(`Cam (${settings.camera_shape})`);
    }
    return chips;
  }, [settings]);

  const openAreaPicker = useCallback((startAfter: boolean) => {
    setPickRequest((prev) => ({ id: (prev?.id ?? 0) + 1, startAfter }));
  }, []);

  const beginRecordingWithCountdown = useCallback(
    async (countdownSec: number) => {
      cancelCountdown();
      if (countdownSec <= 0) {
        await recording.start();
        return;
      }

      setActiveCountdown(countdownSec);
      let remaining = countdownSec;
      countdownTimerRef.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          cancelCountdown();
          void recording.start();
        } else {
          setActiveCountdown(remaining);
        }
      }, 1000);
    },
    [cancelCountdown, recording],
  );

  const handleStart = useCallback(async () => {
    if (!settings || !canStart) return;
    if (settings.capture_mode === "Area" && !settings.capture_region) {
      openAreaPicker(true);
      return;
    }
    await beginRecordingWithCountdown(settings.countdown_seconds ?? 0);
  }, [beginRecordingWithCountdown, canStart, openAreaPicker, settings]);

  const handleSelectionComplete = useCallback(
    async (_region: CaptureRegion) => {
      await beginRecordingWithCountdown(settings?.countdown_seconds ?? 0);
    },
    [beginRecordingWithCountdown, settings?.countdown_seconds],
  );

  // Open or focus the capture-excluded always-on-top Presenter Teleprompter window
  const toggleTeleprompter = useCallback(async () => {
    if (!isTauriApp()) {
      setIsTeleprompterOpen((v) => !v);
      return;
    }

    try {
      const existing = await WebviewWindow.getByLabel(TELEPROMPTER_WINDOW_LABEL);
      if (existing) {
        await existing.close();
        setIsTeleprompterOpen(false);
        return;
      }

      const win = new WebviewWindow(TELEPROMPTER_WINDOW_LABEL, {
        url: "/?teleprompter=1",
        title: "RecordFlow Teleprompter",
        width: 400,
        height: 380,
        resizable: true,
        decorations: false,
        alwaysOnTop: true,
        contentProtected: true,
        skipTaskbar: false,
        visible: true,
        focus: true,
      });

      setIsTeleprompterOpen(true);
      void win.once("tauri://destroyed", () => setIsTeleprompterOpen(false));
      void win.once("tauri://error", () => setIsTeleprompterOpen(false));
    } catch (e) {
      showNotice(`Could not open teleprompter: ${String(e)}`);
    }
  }, [showNotice]);

  // Keep latest handlers in a ref so the Tauri global-hotkey listener never goes stale
  const hotkeyHandlerRef = useRef<(action: string) => void>(() => {});
  hotkeyHandlerRef.current = (action: string) => {
    if (action === "toggle_recording") {
      if (activeCountdown > 0) {
        cancelCountdown();
        return;
      }
      if (recording.status.is_recording) {
        void recording.stop();
      } else {
        void handleStart();
      }
      return;
    }

    if (action === "toggle_pause" && recording.status.is_recording) {
      if (recording.status.is_paused) {
        void recording.resume();
      } else {
        void recording.pause();
      }
    }
  };

  useEffect(() => {
    if (!isTauriApp()) return;
    const unlistenPromise = listen<{ action?: string; source?: string }>(
      "recordflow-hotkey",
      (event) => {
        if (event.payload?.action) {
          hotkeyHandlerRef.current(event.payload.action);
        }
      },
    );
    return () => {
      void unlistenPromise.then((fn) => fn());
    };
  }, []);

  if (settingsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-300">
        <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-4">
          <img src="/recordflow.png" alt="RecordFlow" className="h-8 w-8 rounded-lg" />
          <div>
            <div className="text-sm font-semibold text-white">RecordFlow</div>
            <div className="text-xs text-zinc-400">Initializing capture devices...</div>
          </div>
        </div>
      </div>
    );
  }

  if (settingsError && !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-200">
        <div className="max-w-md rounded-2xl border border-red-500/30 bg-zinc-900 p-6">
          <h1 className="text-lg font-bold text-white">RecordFlow</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Failed to load settings. Make sure the desktop backend is running.
          </p>
          <pre className="mt-3 rounded-lg bg-zinc-950 p-3 text-xs text-red-400 whitespace-pre-wrap">
            {settingsError}
          </pre>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  const isLocked = recording.status.is_recording || activeCountdown > 0;

  const onCaptureModeChange = async (mode: CaptureMode) => {
    if (mode === "Window") {
      const list = await refreshWindows();
      const stillValid = list.some((w) => w.id === settings.selected_window);
      await updateSettings({
        capture_mode: mode,
        screen_enabled: true,
        selected_window: stillValid ? settings.selected_window : (list[0]?.id ?? null),
      });
      return;
    }

    await updateSettings({
      capture_mode: mode,
      screen_enabled: true,
    });
  };

  const onSelectDisplay = async (index: number) => {
    const changed = index !== settings.selected_display;
    await updateSettings({
      selected_display: index,
      capture_region: changed ? null : settings.capture_region,
    });
  };

  const onCaptureRegionChange = async (region: CaptureRegion | null) => {
    await updateSettings({
      capture_region: region,
      capture_mode: region ? "Area" : settings.capture_mode,
      screen_enabled: true,
      selected_display: activeDisplay?.index ?? settings.selected_display,
    });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <Sidebar
        isRecording={recording.status.is_recording}
        isPaused={recording.status.is_paused}
        elapsedSeconds={recording.status.elapsed_seconds}
        lastRecording={lastInfo}
        history={history.sessions}
        summaryChips={summaryChips}
        hotkeys={hotkeys}
        countdownSeconds={settings.countdown_seconds ?? 0}
        onCountdownChange={(countdown_seconds) => void updateSettings({ countdown_seconds })}
        autoMinimize={settings.auto_minimize ?? false}
        onAutoMinimizeChange={(auto_minimize) => void updateSettings({ auto_minimize })}
        onStart={handleStart}
        onStop={async () => {
          await recording.stop();
        }}
        onPause={recording.pause}
        onResume={recording.resume}
        loading={recording.loading}
        error={
          displays.length === 0 && settings.capture_mode !== "Window"
            ? "No display found for screen recording"
            : recording.error
        }
        canStart={canStart}
        startHint={startHint}
        onClearHistory={history.clear}
        onRemoveSession={history.remove}
        historyLoading={history.loading}
        historyError={history.error}
        fileError={fileError}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Studio Toolbar */}
        <header className="flex h-13 shrink-0 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/90 px-6 py-2.5">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">Capture Studio</span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono text-[11px] text-zinc-500">v{APP_VERSION}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleTeleprompter()}
              title="Open capture-excluded presenter script window"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                isTeleprompterOpen
                  ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-300"
                  : "border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-700 hover:text-white"
              }`}
            >
              <FileTextIcon className="h-3.5 w-3.5" />
              <span>Teleprompter</span>
            </button>

            <button
              type="button"
              onClick={() => setIsHotkeyModalOpen(true)}
              title="Configure global keyboard shortcuts & system tray"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
            >
              <KeyboardIcon className="h-3.5 w-3.5" />
              <span>Shortcuts</span>
            </button>

            <button
              type="button"
              onClick={() => setUpdateCheckToken((n) => n + 1)}
              title="Check GitHub Releases for updates"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              <span>Updates</span>
            </button>
          </div>
        </header>

        {/* Scrollable Settings Workspace */}
        <main className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
          <div className="mx-auto max-w-4xl space-y-5 pb-6">
            {notice && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5 text-xs font-medium text-indigo-200">
                {notice}
              </div>
            )}

            {settingsError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                {settingsError}
              </div>
            )}

            {displayError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                {displayError}
              </div>
            )}

            <ScreenRegionPicker
              display={activeDisplay}
              captureRegion={settings.capture_region}
              disabled={isLocked || !activeDisplay}
              pickRequest={pickRequest}
              onCaptureRegionChange={onCaptureRegionChange}
              onSelectionComplete={handleSelectionComplete}
            />

            <CaptureSourceSection
              captureMode={settings.capture_mode}
              onCaptureModeChange={(mode) => void onCaptureModeChange(mode)}
              displays={displays}
              selectedDisplay={settings.selected_display}
              onSelectDisplay={(idx) => void onSelectDisplay(idx)}
              displayThumbnails={displayThumbnails}
              onRefreshThumbnails={() => void refreshThumbnails(displays)}
              thumbnailsLoading={thumbnailsLoading}
              captureRegion={settings.capture_region}
              onPickArea={() => openAreaPicker(false)}
              onClearArea={() => void updateSettings({ capture_region: null })}
              windows={windows}
              selectedWindow={settings.selected_window}
              onSelectWindow={(windowId) => void updateSettings({ selected_window: windowId })}
              onRefreshWindows={() => void refreshWindows()}
              windowsLoading={windowsLoading}
              disabled={isLocked}
            />

            <VideoSettings
              captureMode={settings.capture_mode}
              activeDisplay={activeDisplay}
              activeWindow={activeWindow}
              captureRegion={settings.capture_region}
              selectedResolution={settings.resolution}
              fps={settings.fps}
              bitrate={settings.bitrate}
              captureCursor={settings.capture_cursor}
              disabled={isLocked}
              onResolutionChange={(r: Resolution) => void updateSettings({ resolution: r })}
              onFpsChange={(fps: number) => void updateSettings({ fps })}
              onBitrateChange={(bitrate: number) => void updateSettings({ bitrate })}
              onCaptureCursorChange={(capture_cursor: boolean) =>
                void updateSettings({ capture_cursor })
              }
            />

            <CameraSettings
              cameraEnabled={settings.camera_enabled}
              onToggle={(camera_enabled: boolean) => void updateSettings({ camera_enabled })}
              selectedCamera={settings.selected_camera ?? ""}
              onCameraChange={(selected_camera: string) => void updateSettings({ selected_camera })}
              selectedPosition={settings.camera_position}
              onPositionChange={(camera_position: CameraPosition) =>
                void updateSettings({ camera_position })
              }
              selectedSize={settings.camera_size}
              onSizeChange={(camera_size: CameraSize) => void updateSettings({ camera_size })}
              selectedShape={settings.camera_shape}
              onShapeChange={(camera_shape: CameraShape) => void updateSettings({ camera_shape })}
              cameraMirror={settings.camera_mirror}
              onMirrorChange={(camera_mirror: boolean) => void updateSettings({ camera_mirror })}
              isRecording={isLocked}
            />

            <AudioSettings
              micEnabled={settings.mic_enabled}
              onMicToggle={(mic_enabled: boolean) => void updateSettings({ mic_enabled })}
              selectedMic={settings.microphone_device}
              onMicChange={(microphone_device: string) => void updateSettings({ microphone_device })}
              micVolume={settings.mic_volume}
              onMicVolume={(mic_volume: number) => void updateSettings({ mic_volume })}
              systemAudioEnabled={settings.system_audio_enabled}
              onSystemAudioToggle={(system_audio_enabled: boolean) =>
                void updateSettings({ system_audio_enabled })
              }
              selectedSystemAudio={settings.system_audio_device}
              onSystemAudioChange={(system_audio_device: string) =>
                void updateSettings({ system_audio_device })
              }
              systemAudioVolume={settings.system_audio_volume}
              onSystemAudioVolume={(system_audio_volume: number) =>
                void updateSettings({ system_audio_volume })
              }
              disabled={isLocked}
            />
          </div>
        </main>
      </div>

      {/* Overlays & Modals */}
      <CountdownOverlay count={activeCountdown} onCancel={cancelCountdown} />

      <HotkeyModal
        isOpen={isHotkeyModalOpen}
        hotkeys={hotkeys}
        onSaved={(next) => {
          setHotkeys(next);
          showNotice("Global shortcuts saved.");
        }}
        onClose={() => setIsHotkeyModalOpen(false)}
      />

      {/* Browser-mode fallback floating teleprompter (Tauri uses a separate capture-excluded window) */}
      {!isTauriApp() && (
        <TeleprompterWindow
          isOpen={isTeleprompterOpen}
          isRecording={recording.status.is_recording}
          isPaused={recording.status.is_paused}
          onClose={() => setIsTeleprompterOpen(false)}
        />
      )}

      <UpdateBanner
        busy={recording.status.is_recording}
        manualCheckToken={updateCheckToken}
        onNotice={showNotice}
      />
    </div>
  );
}
