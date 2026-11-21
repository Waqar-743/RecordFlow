import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertBanner } from "../components/AlertBanner";
import { CountdownOverlay } from "../components/CountdownOverlay";
import { EditWorkspace } from "../components/EditWorkspace";
import { ExportModal } from "../components/ExportModal";
import { HotkeyModal } from "../components/HotkeyModal";
import { RecordWorkspace } from "../components/RecordWorkspace";
import { ScreenRegionPicker, type AreaPickRequest } from "../components/ScreenRegionPicker";
import { SourcePickerModal } from "../components/SourcePickerModal";
import { TeleprompterWindow } from "../components/TeleprompterWindow";
import { TopBar } from "../components/TopBar";
import {
  createDefaultProject,
  extractWaveformFromUrl,
  generateSyntheticWaveform,
} from "../editor/canvasRenderer";
import { generateStudioDemoProject } from "../editor/demoGenerator";
import { useRecording } from "../hooks/useRecording";
import { useSettings } from "../hooks/useSettings";
import {
  BrowserCaptureController,
  loadNativeRecordingIntoProject,
  probeVideoMetadata,
} from "../services/browserCapture";
import {
  DEFAULT_HOTKEYS,
  isTauriApp,
  loadNativeSidecars,
  openProjectOrVideoFile,
  saveProjectToFile,
  tauriService,
} from "../services/tauri.service";
import type {
  AlertBannerItem,
  CaptureMode,
  CaptureRegion,
  DisplayInfo,
  EditorProject,
  HotkeyConfig,
  WindowInfo,
  WorkspaceMode,
} from "../types";

const TELEPROMPTER_WINDOW_LABEL = "teleprompter";

export function StudioApp() {
  const { settings, loading: settingsLoading, error: settingsError, updateSettings } = useSettings();
  const recording = useRecording();

  const [workspace, setWorkspace] = useState<WorkspaceMode>("record");
  const [project, setProject] = useState<EditorProject | null>(null);

  // Capture source previews
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [displayThumbnails, setDisplayThumbnails] = useState<Record<number, string>>({});
  const [thumbnailsLoading, setThumbnailsLoading] = useState(false);
  const displayThumbUrlsRef = useRef<string[]>([]);

  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [windowThumbnails, setWindowThumbnails] = useState<Record<string, string>>({});
  const [windowsLoading, setWindowsLoading] = useState(false);
  const [windowThumbLoadingId, setWindowThumbLoadingId] = useState<string | null>(null);
  const winThumbUrlsRef = useRef<Map<string, string>>(new Map());
  const winThumbReqSeqRef = useRef<Record<string, number>>({});

  // Area picker & modals
  const [pickRequest, setPickRequest] = useState<AreaPickRequest | null>(null);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isHotkeyModalOpen, setIsHotkeyModalOpen] = useState(false);
  const [isScriptOpen, setIsScriptOpen] = useState(false);
  const [hotkeys, setHotkeys] = useState<HotkeyConfig>(DEFAULT_HOTKEYS);
  const [recordingsFolder, setRecordingsFolder] = useState<string>("");

  // Countdown & alerts
  const [activeCountdown, setActiveCountdown] = useState(0);
  const countdownTimerRef = useRef<number | null>(null);
  const [alert, setAlert] = useState<AlertBannerItem | null>(null);

  // Browser capture engine for non-Tauri dev/preview end-to-end pipeline
  const browserCaptureRef = useRef<BrowserCaptureController | null>(null);
  const handledOutputRef = useRef<string | null>(null);
  const wasRecordingRef = useRef(false);

  const showAlert = useCallback((item: Omit<AlertBannerItem, "id">) => {
    setAlert({ id: String(Date.now()), ...item });
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
          const bytes = await tauriService.getDisplayThumbnail(d.index, 800);
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
      displayThumbUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      displayThumbUrlsRef.current = nextUrls;
      setDisplayThumbnails(nextMap);
    } finally {
      setThumbnailsLoading(false);
    }
  }, []);

  const fetchWindowThumbnail = useCallback(async (windowId: string, maxWidth = 800) => {
    if (!windowId) return;
    const seq = (winThumbReqSeqRef.current[windowId] ?? 0) + 1;
    winThumbReqSeqRef.current[windowId] = seq;
    setWindowThumbLoadingId(windowId);
    try {
      const bytes = await tauriService.getWindowThumbnail(windowId, maxWidth);
      if (winThumbReqSeqRef.current[windowId] !== seq) return;
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const prevUrl = winThumbUrlsRef.current.get(windowId);
      winThumbUrlsRef.current.set(windowId, url);
      setWindowThumbnails((prev) => ({ ...prev, [windowId]: url }));
      if (prevUrl && prevUrl !== url) {
        URL.revokeObjectURL(prevUrl);
      }
    } catch {
      if (winThumbReqSeqRef.current[windowId] !== seq) return;
      // Remove stale thumbnail if the window is minimized or closed
      const prevUrl = winThumbUrlsRef.current.get(windowId);
      if (prevUrl) {
        winThumbUrlsRef.current.delete(windowId);
        URL.revokeObjectURL(prevUrl);
      }
      setWindowThumbnails((prev) => {
        if (!(windowId in prev)) return prev;
        const next = { ...prev };
        delete next[windowId];
        return next;
      });
    } finally {
      setWindowThumbLoadingId((curr) => (curr === windowId ? null : curr));
    }
  }, []);

  const refreshWindowThumbnails = useCallback(
    async (list: WindowInfo[], priorityWindowId?: string | null) => {
      if (list.length === 0) {
        winThumbUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
        winThumbUrlsRef.current.clear();
        setWindowThumbnails({});
        return;
      }

      // Remove thumbnails for windows that are no longer open
      const validIds = new Set(list.map((w) => w.id));
      for (const [id, url] of Array.from(winThumbUrlsRef.current.entries())) {
        if (!validIds.has(id)) {
          URL.revokeObjectURL(url);
          winThumbUrlsRef.current.delete(id);
        }
      }
      setWindowThumbnails((prev) => {
        const cleaned: Record<string, string> = {};
        for (const [id, url] of Object.entries(prev)) {
          if (validIds.has(id)) cleaned[id] = url;
        }
        return cleaned;
      });

      // Prioritize the currently selected window, then fetch remaining windows in batches
      const ordered = priorityWindowId
        ? [
            ...list.filter((w) => w.id === priorityWindowId),
            ...list.filter((w) => w.id !== priorityWindowId),
          ]
        : list;

      const subset = ordered.slice(0, 24);
      const batchSize = 6;
      for (let i = 0; i < subset.length; i += batchSize) {
        const batch = subset.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (w) => {
            const width = w.id === priorityWindowId ? 800 : 480;
            const bytes = await tauriService.getWindowThumbnail(w.id, width);
            const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
            return [w.id, URL.createObjectURL(blob)] as const;
          }),
        );
        const updates: Record<string, string> = {};
        for (const r of results) {
          if (r.status === "fulfilled") {
            const [id, url] = r.value;
            const prevUrl = winThumbUrlsRef.current.get(id);
            winThumbUrlsRef.current.set(id, url);
            updates[id] = url;
            if (prevUrl && prevUrl !== url) {
              URL.revokeObjectURL(prevUrl);
            }
          }
        }
        if (Object.keys(updates).length > 0) {
          setWindowThumbnails((prev) => ({ ...prev, ...updates }));
        }
      }
    },
    [],
  );

  const refreshWindows = useCallback(
    async (priorityWindowId?: string | null) => {
      setWindowsLoading(true);
      try {
        const list = await tauriService.getCaptureWindows();
        setWindows(list);
        const targetId =
          priorityWindowId && list.some((w) => w.id === priorityWindowId)
            ? priorityWindowId
            : (list[0]?.id ?? null);
        void refreshWindowThumbnails(list, targetId);
        return list;
      } catch {
        setWindows([]);
        return [];
      } finally {
        setWindowsLoading(false);
      }
    },
    [refreshWindowThumbnails],
  );

  const handleSelectWindow = useCallback(
    (windowId: string) => {
      void updateSettings({ selected_window: windowId });
      void fetchWindowThumbnail(windowId, 800);
    },
    [fetchWindowThumbnail, updateSettings],
  );

  // Initial startup load: displays, thumbnails, windows, hotkeys & conflict check
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const list = await tauriService.getDisplays();
        if (cancelled) return;
        setDisplays(list);
        void refreshThumbnails(list);
      } catch (e) {
        if (!cancelled) {
          showAlert({
            severity: "error",
            title: "Display unavailable",
            message: String(e),
          });
        }
      }

      void refreshWindows();

      try {
        const cfg = await tauriService.getHotkeys();
        if (!cancelled && cfg) setHotkeys({ ...DEFAULT_HOTKEYS, ...cfg });
      } catch {
        /* ignore */
      }

      try {
        const folder = await tauriService.getRecordingsFolder();
        if (!cancelled && folder) setRecordingsFolder(folder);
      } catch {
        /* ignore */
      }

      try {
        const failures = await tauriService.getHotkeyFailures();
        if (!cancelled && failures.length > 0) {
          showAlert({
            severity: "warning",
            title: "Shortcut conflict",
            message: `${failures[0].accelerator} could not be registered (${failures[0].reason}).`,
            actionLabel: "Configure",
            onAction: () => setIsHotkeyModalOpen(true),
          });
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      cancelCountdown();
      displayThumbUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      winThumbUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      winThumbUrlsRef.current.clear();
    };
  }, [cancelCountdown, refreshThumbnails, refreshWindows, showAlert]);

  const activeDisplay = useMemo(() => {
    if (!settings) return null;
    return displays.find((d) => d.index === settings.selected_display) ?? displays[0] ?? null;
  }, [displays, settings]);

  // Execute actual capture start (after optional countdown)
  const executeCaptureStart = useCallback(async () => {
    if (!settings) return;
    if (!isTauriApp()) {
      const ctrl = new BrowserCaptureController();
      browserCaptureRef.current = ctrl;
      try {
        await ctrl.start(settings);
      } catch {
        /* fallback handled internally */
      }
    }
    const ok = await recording.start();
    if (!ok && recording.error) {
      showAlert({
        severity: "error",
        title: "Recording failed",
        message: recording.error,
      });
    }
  }, [recording, settings, showAlert]);

  const beginRecordingWithCountdown = useCallback(
    (countdownSec: number) => {
      cancelCountdown();
      if (countdownSec <= 0) {
        void executeCaptureStart();
        return;
      }
      setActiveCountdown(countdownSec);
      let remaining = countdownSec;
      countdownTimerRef.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          cancelCountdown();
          void executeCaptureStart();
        } else {
          setActiveCountdown(remaining);
        }
      }, 1000);
    },
    [cancelCountdown, executeCaptureStart],
  );

  const handleStopRecording = useCallback(async () => {
    let browserRes = null;
    if (!isTauriApp() && browserCaptureRef.current) {
      browserRes = await browserCaptureRef.current.stop();
      browserCaptureRef.current = null;
    }

    await recording.stop();

    if (!isTauriApp() && browserRes) {
      const wf = await extractWaveformFromUrl(browserRes.screenUrl).catch(() =>
        generateSyntheticWaveform(96),
      );
      const nextProj = createDefaultProject({
        name: `Recording ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        screenUrl: browserRes.screenUrl,
        screenPath: null,
        cameraUrl: browserRes.cameraUrl,
        cameraPath: null,
        duration: browserRes.duration,
        sourceWidth: browserRes.width,
        sourceHeight: browserRes.height,
        cursorTrack: browserRes.cursorTrack,
        waveform: wf,
      });
      setProject(nextProj);
      setWorkspace("edit");
      showAlert({
        severity: "success",
        title: "Recording ready",
        message: "Switched to Edit Studio — customize canvas, camera, zoom, and export locally.",
      });
    }
  }, [recording, showAlert]);

  // Automatic transition to Edit Studio when a native Tauri recording completes
  useEffect(() => {
    if (recording.status.is_recording) {
      wasRecordingRef.current = true;
      return;
    }
    if (
      wasRecordingRef.current &&
      !recording.status.is_recording &&
      recording.status.output_file &&
      isTauriApp() &&
      handledOutputRef.current !== recording.status.output_file
    ) {
      wasRecordingRef.current = false;
      const outPath = recording.status.output_file;
      handledOutputRef.current = outPath;
      void (async () => {
        try {
          const nextProj = await loadNativeRecordingIntoProject(
            outPath,
            recording.status.elapsed_seconds,
          );
          setProject(nextProj);
          setWorkspace("edit");
          showAlert({
            severity: "success",
            title: "Recording captured",
            message: "Opened in Edit Studio with your synced layers ready to customize.",
          });
        } catch (e) {
          showAlert({
            severity: "error",
            title: "Could not open recording",
            message: String(e),
          });
        }
      })();
    }
  }, [
    recording.status.elapsed_seconds,
    recording.status.is_recording,
    recording.status.output_file,
    showAlert,
  ]);

  const handlePauseRecording = useCallback(async () => {
    if (!isTauriApp()) browserCaptureRef.current?.pause();
    await recording.pause();
  }, [recording]);

  const handleResumeRecording = useCallback(async () => {
    if (!isTauriApp()) browserCaptureRef.current?.resume();
    await recording.resume();
  }, [recording]);

  const [hasUserPickedArea, setHasUserPickedArea] = useState(false);

  // Clear any stale persisted capture_region from previous sessions on startup
  // so Area mode never shows an already-decided region until the user selects one.
  const clearedInitialRegionRef = useRef(false);
  useEffect(() => {
    if (!settings || clearedInitialRegionRef.current) return;
    clearedInitialRegionRef.current = true;
    if (settings.capture_region !== null) {
      void updateSettings({
        capture_region: null,
        capture_mode: settings.capture_mode === "Area" ? "Screen" : settings.capture_mode,
      });
    }
  }, [settings, updateSettings]);

  // Capture mode switcher (Screen / Area / Window)
  const openAreaPicker = useCallback((startAfter: boolean) => {
    setPickRequest((prev) => ({ id: (prev?.id ?? 0) + 1, startAfter }));
  }, []);

  const handleCaptureModeChange = useCallback(
    async (mode: CaptureMode) => {
      if (!settings) return;
      if (mode === "Area") {
        setHasUserPickedArea(false);
        await updateSettings({
          capture_mode: "Area",
          capture_region: null,
          screen_enabled: true,
        });
        openAreaPicker(false);
        return;
      }
      if (mode === "Window") {
        await updateSettings({
          capture_mode: "Window",
          screen_enabled: true,
        });
        const list = await refreshWindows(settings.selected_window);
        const stillValid = list.some((w) => w.id === settings.selected_window);
        const nextWindowId = stillValid ? settings.selected_window : (list[0]?.id ?? null);
        if (nextWindowId !== settings.selected_window) {
          await updateSettings({
            capture_mode: "Window",
            screen_enabled: true,
            selected_window: nextWindowId,
          });
        }
        if (nextWindowId) {
          void fetchWindowThumbnail(nextWindowId, 800);
        }
        return;
      }
      await updateSettings({ capture_mode: "Screen", screen_enabled: true });
      void refreshThumbnails(displays);
    },
    [
      displays,
      fetchWindowThumbnail,
      openAreaPicker,
      refreshThumbnails,
      refreshWindows,
      settings,
      updateSettings,
    ],
  );

  // Presenter Script / Teleprompter panel toggle
  const handleToggleScript = useCallback(async () => {
    if (!isTauriApp()) {
      setIsScriptOpen((v) => !v);
      return;
    }
    try {
      const existing = await WebviewWindow.getByLabel(TELEPROMPTER_WINDOW_LABEL);
      if (existing) {
        await existing.close();
        setIsScriptOpen(false);
        return;
      }
      const win = new WebviewWindow(TELEPROMPTER_WINDOW_LABEL, {
        url: "/?teleprompter=1",
        title: "RecordFlow Script",
        width: 400,
        height: 400,
        resizable: true,
        decorations: false,
        alwaysOnTop: true,
        contentProtected: true,
        visible: true,
        focus: true,
      });
      setIsScriptOpen(true);
      void win.once("tauri://destroyed", () => setIsScriptOpen(false));
      void win.once("tauri://error", () => setIsScriptOpen(false));
    } catch (e) {
      showAlert({ severity: "error", title: "Script panel", message: String(e) });
    }
  }, [showAlert]);

  // Open project (.rfproj.json) or local video file
  const handleOpenProject = useCallback(async () => {
    try {
      const res = await openProjectOrVideoFile();
      if (!res) return;
      if (res.kind === "project") {
        setProject(res.project);
        setWorkspace("edit");
        showAlert({
          severity: "success",
          title: "Project opened",
          message: `Loaded "${res.project.name}".`,
        });
        return;
      }

      const [meta, sidecars, wf] = await Promise.all([
        probeVideoMetadata(res.url),
        res.path
          ? loadNativeSidecars(res.path)
          : Promise.resolve({ cameraUrl: null, cameraPath: null, cursorTrack: null }),
        extractWaveformFromUrl(res.url).catch(() => generateSyntheticWaveform(96)),
      ]);
      const nextProj = createDefaultProject({
        name: res.fileName.replace(/\.[^.]+$/, ""),
        screenUrl: res.url,
        screenPath: res.path,
        cameraUrl: sidecars.cameraUrl,
        cameraPath: sidecars.cameraPath,
        duration: meta.duration,
        sourceWidth: meta.width,
        sourceHeight: meta.height,
        cursorTrack: sidecars.cursorTrack,
        waveform: wf,
      });
      setProject(nextProj);
      setWorkspace("edit");
      showAlert({
        severity: "info",
        title: "Video imported",
        message: `Loaded "${res.fileName}" into Edit Studio.`,
      });
    } catch (e) {
      showAlert({ severity: "error", title: "Open failed", message: String(e) });
    }
  }, [showAlert]);

  // Save project (.rfproj.json)
  const handleSaveProject = useCallback(async () => {
    if (!project) return;
    try {
      const res = await saveProjectToFile(project);
      if (res.saved) {
        showAlert({
          severity: "success",
          title: "Project saved",
          message: res.path ? `Saved to ${res.path}` : "Project file downloaded.",
        });
      }
    } catch (e) {
      showAlert({ severity: "error", title: "Save failed", message: String(e) });
    }
  }, [project, showAlert]);

  const handleLoadDemo = useCallback(async () => {
    const demo = await generateStudioDemoProject(6);
    setProject(demo);
    setWorkspace("edit");
  }, []);

  // Global shortcut listener (Tauri backend events + browser keyboard shortcut fallback)
  const hotkeyHandlerRef = useRef<(action: string) => void>(() => {});
  hotkeyHandlerRef.current = (action: string) => {
    if (action === "toggle_recording") {
      if (activeCountdown > 0) {
        cancelCountdown();
        return;
      }
      if (recording.status.is_recording) {
        void handleStopRecording();
      } else if (settings) {
        beginRecordingWithCountdown(settings.countdown_seconds ?? 0);
      }
      return;
    }
    if (action === "toggle_pause" && recording.status.is_recording) {
      if (recording.status.is_paused) void handleResumeRecording();
      else void handlePauseRecording();
    }
  };

  useEffect(() => {
    if (!isTauriApp()) return;
    const unlistenPromise = listen<{ action?: string }>("recordflow-hotkey", (event) => {
      if (event.payload?.action) hotkeyHandlerRef.current(event.payload.action);
    });
    return () => {
      void unlistenPromise.then((fn) => fn());
    };
  }, []);

  if (settingsLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ background: "var(--bg)" }}>
        <div
          className="rf-card flex items-center gap-3 rounded-2xl px-6 py-4"
          style={{ color: "var(--text)" }}
        >
          <span
            className="h-3 w-3 rounded-full rf-rec-dot"
            style={{ background: "var(--accent)" }}
          />
          <span className="text-sm font-medium">Starting RecordFlow Studio…</span>
        </div>
      </div>
    );
  }

  if (settingsError && !settings) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6" style={{ background: "var(--bg)" }}>
        <div
          className="rf-card max-w-md rounded-2xl p-6"
          style={{ borderColor: "var(--danger)", color: "var(--text)" }}
        >
          <h1 className="text-base font-semibold">Unable to initialize RecordFlow</h1>
          <p className="mt-1.5 text-xs" style={{ color: "var(--text-2)" }}>
            {settingsError}
          </p>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      {/* 1. Top Navigation Bar */}
      <TopBar
        workspace={workspace}
        onWorkspaceChange={setWorkspace}
        hasProject={Boolean(project)}
        isRecording={recording.status.is_recording}
        isPaused={recording.status.is_paused}
        elapsedSeconds={recording.status.elapsed_seconds}
        onStopRecording={() => void handleStopRecording()}
        isScriptOpen={isScriptOpen}
        onToggleScript={() => void handleToggleScript()}
        onOpenProject={() => void handleOpenProject()}
        onSaveProject={() => void handleSaveProject()}
        onOpenShortcuts={() => setIsHotkeyModalOpen(true)}
      />

      {/* 2. Dismissible Alert Banner */}
      <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />

      {/* 3. Active Workspace: Record or Edit Studio */}
      {workspace === "record" ? (
        <RecordWorkspace
          settings={settings}
          onUpdateSettings={updateSettings}
          displays={displays}
          displayThumbnails={displayThumbnails}
          thumbnailsLoading={thumbnailsLoading}
          onRefreshThumbnails={() => void refreshThumbnails(displays)}
          windows={windows}
          windowThumbnails={windowThumbnails}
          windowsLoading={windowsLoading}
          windowThumbLoading={
            Boolean(settings.selected_window) &&
            windowThumbLoadingId === settings.selected_window
          }
          onRefreshWindows={() => void refreshWindows(settings.selected_window)}
          onSelectWindow={handleSelectWindow}
          onRefreshWindowPreview={(windowId) => void fetchWindowThumbnail(windowId, 800)}
          onCaptureModeChange={(mode) => void handleCaptureModeChange(mode)}
          onPickArea={() => {
            setHasUserPickedArea(false);
            void updateSettings({ capture_mode: "Area", capture_region: null, screen_enabled: true });
            openAreaPicker(false);
          }}
          onSelectAreaDirectly={(region) => {
            setHasUserPickedArea(true);
            void updateSettings({
              capture_region: region,
              capture_mode: "Area",
              screen_enabled: true,
              selected_display: activeDisplay?.index ?? settings.selected_display,
            });
          }}
          recordingStatus={recording.status}
          recordingLoading={recording.loading}
          hotkeys={hotkeys}
          recordingsFolder={recordingsFolder}
          onOpenRecordingsFolder={() => {
            void tauriService.openRecordingsFolder().catch((e) =>
              showAlert({
                severity: "error",
                title: "Recordings folder",
                message: String(e),
              }),
            );
          }}
          onChangeRecordingsFolder={() => {
            void (async () => {
              try {
                const picked = await tauriService.pickRecordingsFolder(recordingsFolder);
                if (picked) {
                  setRecordingsFolder(picked);
                  showAlert({
                    severity: "success",
                    title: "Save folder updated",
                    message: `Recordings will be saved to ${picked}`,
                  });
                }
              } catch (e) {
                showAlert({
                  severity: "error",
                  title: "Could not change folder",
                  message: String(e),
                });
              }
            })();
          }}
          onRequestStart={() => {
            if (settings.capture_mode === "Area" && (!hasUserPickedArea || !settings.capture_region)) {
              openAreaPicker(true);
              return;
            }
            void refreshThumbnails(displays);
            void refreshWindows(settings.selected_window);
            setIsSourcePickerOpen(true);
          }}
          onQuickStart={() => {
            if (settings.capture_mode === "Area" && (!hasUserPickedArea || !settings.capture_region)) {
              openAreaPicker(true);
              return;
            }
            beginRecordingWithCountdown(settings.countdown_seconds ?? 0);
          }}
          onStopRecording={() => void handleStopRecording()}
          onPauseRecording={() => void handlePauseRecording()}
          onResumeRecording={() => void handleResumeRecording()}
        />
      ) : (
        <EditWorkspace
          project={project}
          onProjectChange={(updater) => setProject((prev) => (prev ? updater(prev) : prev))}
          onGoToRecord={() => setWorkspace("record")}
          onOpenProject={() => void handleOpenProject()}
          onLoadDemo={handleLoadDemo}
          onOpenExport={() => setIsExportModalOpen(true)}
        />
      )}

      {/* 4. Interactive Region Picker Controller (Native Tauri window OR Browser overlay) */}
      <ScreenRegionPicker
        display={activeDisplay}
        captureRegion={hasUserPickedArea ? settings.capture_region : null}
        disabled={recording.status.is_recording || activeCountdown > 0}
        pickRequest={pickRequest}
        onCaptureRegionChange={async (region: CaptureRegion | null) => {
          setHasUserPickedArea(Boolean(region));
          await updateSettings({
            capture_region: region,
            capture_mode: region ? "Area" : settings.capture_mode,
            screen_enabled: true,
            selected_display: activeDisplay?.index ?? settings.selected_display,
          });
        }}
        onSelectionComplete={async () => {
          beginRecordingWithCountdown(settings.countdown_seconds ?? 0);
        }}
      />

      {/* 5. Screen-Share Source Picker Modal */}
      <SourcePickerModal
        isOpen={isSourcePickerOpen}
        initialMode={settings.capture_mode}
        displays={displays}
        displayThumbnails={displayThumbnails}
        selectedDisplay={settings.selected_display}
        windows={windows}
        windowThumbnails={windowThumbnails}
        selectedWindow={settings.selected_window}
        captureRegion={hasUserPickedArea ? settings.capture_region : null}
        systemAudioEnabled={settings.system_audio_enabled}
        systemAudioDevice={settings.system_audio_device}
        onRefreshSources={() => {
          void refreshThumbnails(displays);
          void refreshWindows(settings.selected_window);
        }}
        onSelectWindowPreview={(windowId) => void fetchWindowThumbnail(windowId, 640)}
        onRequestPickArea={() => {
          setHasUserPickedArea(false);
          void updateSettings({ capture_mode: "Area", capture_region: null, screen_enabled: true });
          openAreaPicker(true);
        }}
        onConfirm={(sel) => {
          setIsSourcePickerOpen(false);
          void (async () => {
            await updateSettings({
              capture_mode: sel.capture_mode,
              selected_display: sel.selected_display,
              selected_window: sel.selected_window,
              system_audio_enabled: sel.system_audio_enabled,
              system_audio_device: sel.system_audio_device,
              screen_enabled: true,
            });
            if (sel.capture_mode === "Area" && (!hasUserPickedArea || !settings.capture_region)) {
              openAreaPicker(true);
              return;
            }
            beginRecordingWithCountdown(settings.countdown_seconds ?? 0);
          })();
        }}
        onClose={() => setIsSourcePickerOpen(false)}
      />

      {/* 6. Local Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        project={project}
        onClose={() => setIsExportModalOpen(false)}
        onExportComplete={(savedPath) =>
          showAlert({
            severity: "success",
            title: "Export complete",
            message: `Saved locally to ${savedPath}`,
          })
        }
      />

      {/* 7. Shortcuts & System Tray Modal */}
      <HotkeyModal
        isOpen={isHotkeyModalOpen}
        hotkeys={hotkeys}
        onSaved={(next, failures) => {
          setHotkeys(next);
          if (failures.length > 0) {
            showAlert({
              severity: "warning",
              title: "Shortcut conflict",
              message: `${failures[0].accelerator}: ${failures[0].reason}`,
              actionLabel: "Configure",
              onAction: () => setIsHotkeyModalOpen(true),
            });
          } else {
            showAlert({
              severity: "success",
              title: "Shortcuts updated",
              message: `Start/Stop is bound to ${next.toggle_recording}.`,
            });
          }
        }}
        onClose={() => setIsHotkeyModalOpen(false)}
      />

      {/* 8. Countdown Overlay */}
      <CountdownOverlay count={activeCountdown} onCancel={cancelCountdown} />

      {/* 9. Browser Fallback Floating Presenter Script Panel */}
      {!isTauriApp() && (
        <TeleprompterWindow
          isOpen={isScriptOpen}
          isRecording={recording.status.is_recording}
          isPaused={recording.status.is_paused}
          onClose={() => setIsScriptOpen(false)}
        />
      )}
    </div>
  );
}
