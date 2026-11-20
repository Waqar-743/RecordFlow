import { useEffect, useMemo, useRef, useState } from "react";
import { tauriService } from "../services/tauri.service";
import type {
  AudioDeviceInfo,
  CameraInfo,
  CaptureMode,
  CaptureRegion,
  DisplayInfo,
  HotkeyConfig,
  RecordingSettings,
  RecordingStatus,
  WindowInfo,
} from "../types";
import { createAudioLevelMeter } from "../utils/audioMeter";
import {
  AppWindowIcon,
  CameraIcon,
  CameraOffIcon,
  CropIcon,
  EyeOffIcon,
  MicIcon,
  MicOffIcon,
  MonitorIcon,
  PauseIcon,
  PlayIcon,
  RecordDotIcon,
  RefreshIcon,
  SearchIcon,
  SpeakerIcon,
  StopIcon,
  TimerIcon,
} from "./Icons";
import { ToggleSwitch } from "./ToggleSwitch";

type Props = {
  settings: RecordingSettings;
  onUpdateSettings: (patch: Partial<RecordingSettings>) => Promise<void>;
  displays: DisplayInfo[];
  displayThumbnails: Record<number, string>;
  thumbnailsLoading: boolean;
  onRefreshThumbnails: () => void;
  windows: WindowInfo[];
  windowThumbnails: Record<string, string>;
  windowsLoading: boolean;
  onRefreshWindows: () => void;
  onCaptureModeChange: (mode: CaptureMode) => void;
  onPickArea: () => void;
  recordingStatus: RecordingStatus;
  recordingLoading: boolean;
  hotkeys: HotkeyConfig;
  onRequestStart: () => void;
  onStopRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RecordWorkspace({
  settings,
  onUpdateSettings,
  displays,
  displayThumbnails,
  thumbnailsLoading,
  onRefreshThumbnails,
  windows,
  windowThumbnails,
  windowsLoading,
  onRefreshWindows,
  onCaptureModeChange,
  onPickArea,
  recordingStatus,
  recordingLoading,
  hotkeys,
  onRequestStart,
  onStopRecording,
  onPauseRecording,
  onResumeRecording,
}: Props) {
  const [mics, setMics] = useState<AudioDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [windowFilter, setWindowFilter] = useState("");
  const [camPreviewReady, setCamPreviewReady] = useState(false);

  const camMiniVideoRef = useRef<HTMLVideoElement | null>(null);
  const camStageVideoRef = useRef<HTMLVideoElement | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);

  const isRecording = recordingStatus.is_recording;
  const isPaused = recordingStatus.is_paused;

  // Load microphones & cameras on mount
  useEffect(() => {
    let active = true;
    void Promise.all([
      tauriService.getAudioInputs().catch(() => []),
      tauriService.getCameras().catch(() => []),
    ]).then(([audioList, camList]) => {
      if (!active) return;
      setMics(audioList);
      setCameras(camList);
    });
    return () => {
      active = false;
    };
  }, []);

  // Live microphone VU meter when mic is enabled & not recording
  useEffect(() => {
    if (!settings.mic_enabled || isRecording || !navigator.mediaDevices?.getUserMedia) {
      setMicLevel(0);
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let stopMeter: (() => void) | null = null;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        stopMeter = createAudioLevelMeter(stream, (lvl) => {
          if (!cancelled) setMicLevel(lvl);
        });
      } catch {
        setMicLevel(0);
      }
    })();

    return () => {
      cancelled = true;
      stopMeter?.();
      stream?.getTracks().forEach((t) => t.stop());
      setMicLevel(0);
    };
  }, [isRecording, settings.mic_enabled, settings.microphone_device]);

  // Live webcam preview stream when camera is enabled & idle (released during native Tauri recording)
  useEffect(() => {
    const release = () => {
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
      if (camMiniVideoRef.current) camMiniVideoRef.current.srcObject = null;
      if (camStageVideoRef.current) camStageVideoRef.current.srcObject = null;
      setCamPreviewReady(false);
    };

    if (!settings.camera_enabled || isRecording || !navigator.mediaDevices?.getUserMedia) {
      release();
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        let deviceId: string | undefined;
        if (navigator.mediaDevices.enumerateDevices) {
          const videoDevs = (await navigator.mediaDevices.enumerateDevices()).filter(
            (d) => d.kind === "videoinput",
          );
          const idx = Number.parseInt(settings.selected_camera ?? "0", 10);
          if (Number.isFinite(idx) && videoDevs[idx]?.deviceId) {
            deviceId = videoDevs[idx].deviceId;
          }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
            : { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        camStreamRef.current = stream;
        if (camMiniVideoRef.current) {
          camMiniVideoRef.current.srcObject = stream;
          void camMiniVideoRef.current.play().catch(() => {});
        }
        if (camStageVideoRef.current) {
          camStageVideoRef.current.srcObject = stream;
          void camStageVideoRef.current.play().catch(() => {});
        }
        setCamPreviewReady(true);
      } catch {
        setCamPreviewReady(false);
      }
    })();

    return () => {
      cancelled = true;
      release();
    };
  }, [isRecording, settings.camera_enabled, settings.selected_camera]);

  // Re-attach camera stream when switching capture modes
  useEffect(() => {
    if (!camStreamRef.current) return;
    if (camStageVideoRef.current && camStageVideoRef.current.srcObject !== camStreamRef.current) {
      camStageVideoRef.current.srcObject = camStreamRef.current;
      void camStageVideoRef.current.play().catch(() => {});
    }
  }, [settings.capture_mode, camPreviewReady]);

  const activeDisplay = useMemo(
    () => displays.find((d) => d.index === settings.selected_display) ?? displays[0] ?? null,
    [displays, settings.selected_display],
  );

  const activeWindow = useMemo(
    () => windows.find((w) => w.id === settings.selected_window) ?? null,
    [settings.selected_window, windows],
  );

  const filteredWindows = useMemo(() => {
    const q = windowFilter.trim().toLowerCase();
    if (!q) return windows;
    return windows.filter(
      (w) => w.title.toLowerCase().includes(q) || w.process.toLowerCase().includes(q),
    );
  }, [windowFilter, windows]);

  const activeThumb = activeDisplay ? displayThumbnails[activeDisplay.index] : undefined;
  const activeWinThumb = activeWindow ? windowThumbnails[activeWindow.id] : undefined;

  // Resolution badge label
  const resolutionLabel = useMemo(() => {
    if (settings.capture_mode === "Area" && settings.capture_region) {
      return `${settings.capture_region.width} × ${settings.capture_region.height}`;
    }
    if (settings.capture_mode === "Window" && activeWindow) {
      return `${activeWindow.width} × ${activeWindow.height}`;
    }
    if (activeDisplay) {
      return `${activeDisplay.width} × ${activeDisplay.height}`;
    }
    return "1920 × 1080";
  }, [activeDisplay, activeWindow, settings.capture_mode, settings.capture_region]);

  const statusBadgeText = isRecording
    ? isPaused
      ? `Paused · ${formatTime(recordingStatus.elapsed_seconds)}`
      : `Recording · ${formatTime(recordingStatus.elapsed_seconds)}`
    : "Ready";

  const statusDotColor = isRecording
    ? isPaused
      ? "var(--warning)"
      : "var(--record)"
    : "var(--success)";

  const areaCropStyle = useMemo(() => {
    const reg: CaptureRegion | null = settings.capture_region;
    if (!reg || !activeDisplay) return null;
    return {
      left: `${(reg.x / Math.max(1, activeDisplay.width)) * 100}%`,
      top: `${(reg.y / Math.max(1, activeDisplay.height)) * 100}%`,
      width: `${(reg.width / Math.max(1, activeDisplay.width)) * 100}%`,
      height: `${(reg.height / Math.max(1, activeDisplay.height)) * 100}%`,
    };
  }, [activeDisplay, settings.capture_region]);

  const modes: { id: CaptureMode; label: string; Icon: typeof MonitorIcon }[] = [
    { id: "Screen", label: "Screen", Icon: MonitorIcon },
    { id: "Area", label: "Area", Icon: CropIcon },
    { id: "Window", label: "Window", Icon: AppWindowIcon },
  ];

  const canStart =
    settings.capture_mode === "Window" ? Boolean(activeWindow) : displays.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Main Scrollable Stage & Cards */}
      <div className="flex-1 overflow-y-auto rf-scroll px-6 py-5">
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          {/* Header Row: Title + Interaction Tracking Subtitle + Segmented Mode Switcher */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1
                className="text-xl font-semibold tracking-tight"
                style={{ color: "var(--text)" }}
              >
                New recording
              </h1>
              <p className="mt-1 text-xs" style={{ color: "var(--text-2)" }}>
                Cursor movements and clicks are tracked automatically for smooth post-recording zoom and studio polish.
              </p>
            </div>

            {/* Segmented Capture-Mode Switcher */}
            <div
              role="tablist"
              aria-label="Capture mode"
              className="inline-flex items-center rounded-xl p-1"
              style={{
                background: "var(--inset)",
                border: "1px solid var(--border)",
              }}
            >
              {modes.map(({ id, label, Icon }) => {
                const active = settings.capture_mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    disabled={isRecording}
                    onClick={() => onCaptureModeChange(id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                      isRecording ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                    }`}
                    style={
                      active
                        ? {
                            background: "var(--surface-2)",
                            color: "var(--text)",
                            boxShadow: "var(--shadow-sm)",
                          }
                        : { color: "var(--text-2)" }
                    }
                  >
                    <Icon
                      className="h-3.5 w-3.5"
                      style={{ color: active ? "var(--accent)" : "var(--text-3)" }}
                    />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview Stage */}
          {settings.capture_mode === "Window" ? (
            /* WINDOW MODE: Split "Choose a window" list + Focused Window Preview Stage */
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* Left: Scrollable Choose a Window List */}
              <div className="rf-card flex h-[360px] flex-col overflow-hidden rounded-2xl lg:col-span-5">
                <div
                  className="flex items-center justify-between gap-2 px-4 py-3"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div>
                    <h2 className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                      Choose a window
                    </h2>
                    <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                      {windows.length} active {windows.length === 1 ? "window" : "windows"} detected
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={windowsLoading || isRecording}
                    onClick={onRefreshWindows}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      color: "var(--text-2)",
                    }}
                  >
                    <RefreshIcon className={`h-3.5 w-3.5 ${windowsLoading ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                {/* Search box */}
                <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                    style={{ background: "var(--inset)", border: "1px solid var(--border)" }}
                  >
                    <SearchIcon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-3)" }} />
                    <input
                      type="text"
                      value={windowFilter}
                      onChange={(e) => setWindowFilter(e.target.value)}
                      placeholder="Filter open windows or apps…"
                      className="w-full bg-transparent text-xs outline-none"
                      style={{ color: "var(--text)" }}
                    />
                  </div>
                </div>

                {/* Scrollable list */}
                <div className="flex-1 space-y-1 overflow-y-auto p-2 rf-scroll">
                  {filteredWindows.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                      <AppWindowIcon className="h-8 w-8 mb-2" style={{ color: "var(--text-3)" }} />
                      <div className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                        {windowsLoading ? "Scanning active windows…" : "No matching windows found"}
                      </div>
                      <p className="mt-1 text-[11px]" style={{ color: "var(--text-3)" }}>
                        Make sure the app window is open and not minimized, then click Refresh.
                      </p>
                    </div>
                  ) : (
                    filteredWindows.map((w) => {
                      const selected = settings.selected_window === w.id;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          disabled={isRecording}
                          onClick={() => void onUpdateSettings({ selected_window: w.id })}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all"
                          style={{
                            background: selected ? "var(--accent-soft)" : "transparent",
                            border: `1px solid ${selected ? "var(--accent)" : "transparent"}`,
                          }}
                        >
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                            style={{
                              background: selected ? "var(--accent)" : "var(--surface-2)",
                              color: selected ? "var(--accent-fg)" : "var(--text-2)",
                            }}
                          >
                            <AppWindowIcon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-xs font-semibold"
                              style={{ color: "var(--text)" }}
                            >
                              {w.title}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-3)" }}>
                              <span className="truncate font-mono">{w.process || "Application"}</span>
                              <span>·</span>
                              <span className="shrink-0 font-mono">
                                {w.width} × {w.height}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right: Focused Window Preview Stage */}
              <div className="rf-stage-bg relative flex h-[360px] flex-col items-center justify-center overflow-hidden rounded-2xl p-6 lg:col-span-7"
                style={{ border: "1px solid var(--border)" }}
              >
                {/* Floating Status & Resolution Badge */}
                <div
                  className="absolute left-4 top-4 z-10 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-md"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text)",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${isRecording && !isPaused ? "rf-rec-dot" : ""}`}
                    style={{ background: statusDotColor }}
                  />
                  <span>{statusBadgeText}</span>
                  <span style={{ color: "var(--text-3)" }}>·</span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-2)" }}>
                    {resolutionLabel}
                  </span>
                </div>

                {activeWindow ? (
                  <div className="flex w-full max-w-lg flex-col items-center gap-4">
                    {activeWinThumb ? (
                      <div
                        className="relative w-full overflow-hidden rounded-xl"
                        style={{
                          border: "1px solid var(--border-strong)",
                          boxShadow: "var(--shadow-lg)",
                        }}
                      >
                        <img
                          src={activeWinThumb}
                          alt={activeWindow.title}
                          className="max-h-52 w-full object-contain bg-black/40"
                        />
                      </div>
                    ) : (
                      <div
                        className="flex h-20 w-20 items-center justify-center rounded-2xl"
                        style={{
                          background: "var(--accent-soft)",
                          border: "1px solid var(--accent)",
                          color: "var(--accent)",
                        }}
                      >
                        <AppWindowIcon className="h-9 w-9" />
                      </div>
                    )}

                    <div className="text-center">
                      <div
                        className="max-w-md truncate text-sm font-semibold"
                        style={{ color: "var(--text)" }}
                      >
                        {activeWindow.title}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
                        <span
                          className="rounded-full px-2.5 py-0.5 font-mono text-[11px]"
                          style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
                        >
                          {activeWindow.process}
                        </span>
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                        >
                          Only this window is recorded
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <AppWindowIcon className="mx-auto mb-2 h-10 w-10" style={{ color: "var(--text-3)" }} />
                    <div className="text-sm font-medium" style={{ color: "var(--text-2)" }}>
                      Select a window from the list
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-3)" }}>
                      Only the chosen application window will be captured.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* SCREEN & AREA MODE: Full-width Studio Live Preview Stage */
            <div
              className="rf-stage-bg relative flex h-[360px] flex-col items-center justify-center overflow-hidden rounded-2xl p-5"
              style={{ border: "1px solid var(--border)" }}
            >
              {/* Top-left floating Status & Resolution Badge */}
              <div
                className="absolute left-4 top-4 z-10 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-md"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border-strong)",
                  color: "var(--text)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <span
                  className={`h-2 w-2 rounded-full ${isRecording && !isPaused ? "rf-rec-dot" : ""}`}
                  style={{ background: statusDotColor }}
                />
                <span>{statusBadgeText}</span>
                <span style={{ color: "var(--text-3)" }}>·</span>
                <span className="font-mono text-[11px]" style={{ color: "var(--text-2)" }}>
                  {resolutionLabel}
                </span>
              </div>

              {/* Top-right Controls: Display Switcher / Area Actions / Refresh */}
              <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
                {displays.length > 1 && (
                  <div
                    className="inline-flex items-center rounded-lg p-0.5"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border-strong)",
                    }}
                  >
                    {displays.map((d) => {
                      const active = d.index === settings.selected_display;
                      return (
                        <button
                          key={d.index}
                          type="button"
                          disabled={isRecording}
                          onClick={() =>
                            void onUpdateSettings({
                              selected_display: d.index,
                              capture_region: null,
                            })
                          }
                          className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                          style={
                            active
                              ? { background: "var(--accent)", color: "var(--accent-fg)" }
                              : { color: "var(--text-2)" }
                          }
                        >
                          Display {d.index + 1}
                        </button>
                      );
                    })}
                  </div>
                )}

                {settings.capture_mode === "Area" && (
                  <button
                    type="button"
                    disabled={isRecording}
                    onClick={onPickArea}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
                    style={{
                      background: "var(--accent)",
                      color: "var(--accent-fg)",
                    }}
                  >
                    <CropIcon className="h-3.5 w-3.5" />
                    <span>{settings.capture_region ? "Reselect area" : "Select area"}</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={thumbnailsLoading}
                  onClick={onRefreshThumbnails}
                  title="Refresh live display preview"
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text-2)",
                  }}
                >
                  <RefreshIcon className={`h-3.5 w-3.5 ${thumbnailsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Center Live Preview Frame */}
              <div
                className="relative flex max-h-full max-w-[600px] items-center justify-center overflow-hidden rounded-xl"
                style={{
                  aspectRatio: activeDisplay
                    ? `${activeDisplay.width} / ${activeDisplay.height}`
                    : "16 / 9",
                  height: "100%",
                  border: "1px solid var(--border-strong)",
                  boxShadow: "var(--shadow-lg)",
                  background: "var(--inset)",
                }}
              >
                {activeThumb ? (
                  <img
                    src={activeThumb}
                    alt={activeDisplay?.name ?? "Display preview"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 p-8 text-center">
                    <MonitorIcon className="h-10 w-10" style={{ color: "var(--text-3)" }} />
                    <span className="text-xs" style={{ color: "var(--text-3)" }}>
                      {thumbnailsLoading ? "Capturing display preview…" : "Display preview ready"}
                    </span>
                  </div>
                )}

                {/* Area Mode Locked Region Highlight Overlay */}
                {settings.capture_mode === "Area" && areaCropStyle && (
                  <>
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{ background: "rgba(5, 6, 10, 0.56)" }}
                    />
                    <div
                      className="pointer-events-none absolute rounded-sm"
                      style={{
                        ...areaCropStyle,
                        border: "2px solid var(--accent)",
                        boxShadow: "0 0 0 1px rgba(255,255,255,0.25) inset",
                        background: "rgba(142, 162, 255, 0.14)",
                      }}
                    >
                      <div
                        className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                        style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                      >
                        Area locked · {settings.capture_region?.width}×{settings.capture_region?.height}
                      </div>
                    </div>
                  </>
                )}

                {/* Floating Live Camera Preview Indicator on Stage */}
                {settings.camera_enabled && (
                  <div
                    className="absolute bottom-3 right-3 h-16 w-16 overflow-hidden rounded-full border-2 shadow-xl"
                    style={{
                      borderColor: "var(--accent)",
                      background: "var(--surface-2)",
                    }}
                    title="Camera will be recorded as an independent editable layer"
                  >
                    <video
                      ref={camStageVideoRef}
                      muted
                      playsInline
                      className="h-full w-full object-cover"
                      style={{ transform: settings.camera_mirror ? "scaleX(-1)" : undefined }}
                    />
                    {!camPreviewReady && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <CameraIcon className="h-5 w-5" style={{ color: "var(--text-3)" }} />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Subtle Display Subtitle Bottom-Left */}
              {activeDisplay && (
                <div
                  className="absolute bottom-3.5 left-4 rounded-md px-2 py-0.5 text-[11px]"
                  style={{ background: "var(--surface)", color: "var(--text-3)", border: "1px solid var(--border)" }}
                >
                  {activeDisplay.name}
                  {settings.capture_mode === "Area" && settings.capture_region
                    ? ` · Region (${settings.capture_region.x}, ${settings.capture_region.y})`
                    : ""}
                </div>
              )}
            </div>
          )}

          {/* Three Structured Pre-Recording Control Cards */}
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {/* Card 1: Microphone */}
            <div className="rf-card flex flex-col justify-between gap-3 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      background: settings.mic_enabled ? "var(--accent-soft)" : "var(--surface-2)",
                      color: settings.mic_enabled ? "var(--accent)" : "var(--text-3)",
                    }}
                  >
                    {settings.mic_enabled ? (
                      <MicIcon className="h-4 w-4" />
                    ) : (
                      <MicOffIcon className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                      Microphone
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                      {settings.mic_enabled ? "Voice commentary active" : "Muted"}
                    </div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.mic_enabled}
                  disabled={isRecording}
                  label="Toggle microphone"
                  onChange={(mic_enabled) => void onUpdateSettings({ mic_enabled })}
                />
              </div>

              {settings.mic_enabled ? (
                <div className="space-y-2">
                  <select
                    disabled={isRecording}
                    value={settings.microphone_device}
                    onChange={(e) => void onUpdateSettings({ microphone_device: e.target.value })}
                    className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    style={{
                      background: "var(--inset)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    {mics.length === 0 ? (
                      <option value="">Default Microphone</option>
                    ) : (
                      mics.map((m) => (
                        <option key={`${m.index}-${m.name}`} value={m.name}>
                          {m.name}
                        </option>
                      ))
                    )}
                  </select>
                  {/* Live input level bar */}
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full"
                      style={{ background: "var(--inset)" }}
                    >
                      <div
                        className="h-full rounded-full transition-[width] duration-75"
                        style={{
                          width: `${Math.max(4, Math.round(micLevel * 100))}%`,
                          background: micLevel > 0.8 ? "var(--danger)" : "var(--success)",
                        }}
                      />
                    </div>
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-3)" }}>
                      {Math.round(micLevel * 100)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  className="rounded-lg px-2.5 py-2 text-[11px]"
                  style={{ background: "var(--inset)", color: "var(--text-3)" }}
                >
                  Enable to choose a microphone and monitor input levels.
                </div>
              )}
            </div>

            {/* Card 2: Camera (Independent Stream) */}
            <div className="rf-card flex flex-col justify-between gap-3 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      background: settings.camera_enabled ? "var(--accent-soft)" : "var(--surface-2)",
                      color: settings.camera_enabled ? "var(--accent)" : "var(--text-3)",
                    }}
                  >
                    {settings.camera_enabled ? (
                      <CameraIcon className="h-4 w-4" />
                    ) : (
                      <CameraOffIcon className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                        Camera
                      </span>
                      {settings.camera_enabled && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                        >
                          Separate track
                        </span>
                      )}
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                      {settings.camera_enabled ? "Editable after recording" : "Off"}
                    </div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.camera_enabled}
                  disabled={isRecording}
                  label="Toggle webcam"
                  onChange={(camera_enabled) => void onUpdateSettings({ camera_enabled })}
                />
              </div>

              {settings.camera_enabled ? (
                <div className="flex items-center gap-2.5">
                  <div
                    className="relative h-10 w-14 shrink-0 overflow-hidden rounded-lg"
                    style={{ background: "var(--inset)", border: "1px solid var(--border)" }}
                  >
                    <video
                      ref={camMiniVideoRef}
                      muted
                      playsInline
                      className="h-full w-full object-cover"
                      style={{ transform: settings.camera_mirror ? "scaleX(-1)" : undefined }}
                    />
                  </div>
                  <select
                    disabled={isRecording}
                    value={settings.selected_camera ?? "0"}
                    onChange={(e) => void onUpdateSettings({ selected_camera: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    style={{
                      background: "var(--inset)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    {cameras.length === 0 ? (
                      <option value="0">Default Webcam</option>
                    ) : (
                      cameras.map((c) => (
                        <option key={`${c.index}-${c.name}`} value={String(c.index)}>
                          {c.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              ) : (
                <div
                  className="rounded-lg px-2.5 py-2 text-[11px]"
                  style={{ background: "var(--inset)", color: "var(--text-3)" }}
                >
                  Records webcam as a synced layer you can move or restyle in Edit.
                </div>
              )}
            </div>

            {/* Card 3: Countdown Selector */}
            <div className="rf-card flex flex-col justify-between gap-3 rounded-2xl p-4">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background:
                      (settings.countdown_seconds ?? 0) > 0
                        ? "var(--accent-soft)"
                        : "var(--surface-2)",
                    color:
                      (settings.countdown_seconds ?? 0) > 0 ? "var(--accent)" : "var(--text-3)",
                  }}
                >
                  <TimerIcon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                    Countdown
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                    {(settings.countdown_seconds ?? 0) > 0
                      ? `${settings.countdown_seconds}s on-screen timer before start`
                      : "Starts capture immediately"}
                  </div>
                </div>
              </div>

              <div
                className="grid grid-cols-3 gap-1 rounded-xl p-1"
                style={{ background: "var(--inset)", border: "1px solid var(--border)" }}
              >
                {[
                  { val: 0, label: "Off" },
                  { val: 3, label: "3s" },
                  { val: 5, label: "5s" },
                ].map((opt) => {
                  const active = (settings.countdown_seconds ?? 0) === opt.val;
                  return (
                    <button
                      key={opt.val}
                      type="button"
                      disabled={isRecording}
                      onClick={() => void onUpdateSettings({ countdown_seconds: opt.val })}
                      className="rounded-lg py-1.5 text-xs font-semibold transition-all"
                      style={
                        active
                          ? {
                              background: "var(--surface-2)",
                              color: "var(--text)",
                              boxShadow: "var(--shadow-sm)",
                            }
                          : { color: "var(--text-2)" }
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Prominent Bottom Action Bar */}
      <footer
        className="shrink-0 px-6 py-3.5"
        style={{
          background: "var(--bg-elev)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          {/* Left: Hide App While Recording + System Audio Quick Toggle */}
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex cursor-pointer items-center gap-2.5 select-none">
              <ToggleSwitch
                size="sm"
                checked={settings.auto_minimize}
                disabled={isRecording}
                label="Hide app while recording"
                onChange={(auto_minimize) => void onUpdateSettings({ auto_minimize })}
              />
              <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--text-2)" }}>
                <EyeOffIcon className="h-3.5 w-3.5" style={{ color: "var(--text-3)" }} />
                Hide app while recording
              </span>
            </label>

            <div className="hidden sm:block h-4 w-px" style={{ background: "var(--border)" }} />

            <label className="flex cursor-pointer items-center gap-2.5 select-none">
              <ToggleSwitch
                size="sm"
                checked={settings.system_audio_enabled}
                disabled={isRecording}
                label="Capture system audio"
                onChange={(system_audio_enabled) => void onUpdateSettings({ system_audio_enabled })}
              />
              <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--text-2)" }}>
                <SpeakerIcon className="h-3.5 w-3.5" style={{ color: "var(--text-3)" }} />
                System audio
              </span>
            </label>
          </div>

          {/* Right: Start Recording or Active Transport Controls */}
          <div className="flex items-center gap-2.5">
            {isRecording ? (
              <>
                <div
                  className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 font-mono text-xs font-semibold tabular-nums"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text)",
                  }}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${!isPaused ? "rf-rec-dot" : ""}`}
                    style={{ background: isPaused ? "var(--warning)" : "var(--record)" }}
                  />
                  <span>{formatTime(recordingStatus.elapsed_seconds)}</span>
                </div>

                <button
                  type="button"
                  disabled={recordingLoading}
                  onClick={isPaused ? onResumeRecording : onPauseRecording}
                  className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text)",
                  }}
                >
                  {isPaused ? <PlayIcon className="h-3.5 w-3.5" /> : <PauseIcon className="h-3.5 w-3.5" />}
                  <span>{isPaused ? "Resume" : "Pause"}</span>
                </button>

                <button
                  type="button"
                  disabled={recordingLoading}
                  onClick={onStopRecording}
                  className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition-opacity hover:opacity-90"
                  style={{ background: "var(--record)" }}
                >
                  <StopIcon className="h-3.5 w-3.5" />
                  <span>{recordingLoading ? "Finalizing…" : "Stop & Edit"}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={!canStart || recordingLoading}
                onClick={onRequestStart}
                className={`inline-flex items-center gap-2.5 rounded-xl px-5 py-2.5 text-xs font-semibold shadow-md transition-all ${
                  !canStart || recordingLoading ? "opacity-50 cursor-not-allowed" : "hover:brightness-105 active:scale-[0.99]"
                }`}
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-fg)",
                }}
              >
                <RecordDotIcon className="h-3.5 w-3.5" />
                <span>Start recording</span>
                {hotkeys.toggle_recording && (
                  <kbd
                    className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                    style={{
                      background: "rgba(0, 0, 0, 0.2)",
                      color: "var(--accent-fg)",
                    }}
                  >
                    {hotkeys.toggle_recording}
                  </kbd>
                )}
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
