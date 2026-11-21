import { useEffect, useState } from "react";
import { tauriService } from "../services/tauri.service";
import type {
  AudioDeviceInfo,
  CaptureMode,
  CaptureRegion,
  DisplayInfo,
  WindowInfo,
} from "../types";
import {
  AppWindowIcon,
  CheckIcon,
  CropIcon,
  MonitorIcon,
  RecordDotIcon,
  RefreshIcon,
  SpeakerIcon,
  XIcon,
} from "./Icons";
import { ToggleSwitch } from "./ToggleSwitch";

type PickerTab = "screen" | "window" | "area";

type Props = {
  isOpen: boolean;
  initialMode: CaptureMode;
  displays: DisplayInfo[];
  displayThumbnails: Record<number, string>;
  selectedDisplay: number;
  windows: WindowInfo[];
  windowThumbnails: Record<string, string>;
  selectedWindow: string | null;
  captureRegion: CaptureRegion | null;
  systemAudioEnabled: boolean;
  systemAudioDevice: string;
  onRefreshSources: () => void;
  onRequestPickArea?: () => void;
  onConfirm: (selection: {
    capture_mode: CaptureMode;
    selected_display: number;
    selected_window: string | null;
    system_audio_enabled: boolean;
    system_audio_device: string;
  }) => void;
  onClose: () => void;
};

export function SourcePickerModal({
  isOpen,
  initialMode,
  displays,
  displayThumbnails,
  selectedDisplay,
  windows,
  windowThumbnails,
  selectedWindow,
  captureRegion,
  systemAudioEnabled,
  systemAudioDevice,
  onRefreshSources,
  onRequestPickArea,
  onConfirm,
  onClose,
}: Props) {
  const [tab, setTab] = useState<PickerTab>("screen");
  const [pickedDisplay, setPickedDisplay] = useState(selectedDisplay);
  const [pickedWindow, setPickedWindow] = useState<string | null>(selectedWindow);
  const [shareAudio, setShareAudio] = useState(systemAudioEnabled);
  const [audioDevice, setAudioDevice] = useState(systemAudioDevice);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setTab(
      initialMode === "Window"
        ? "window"
        : initialMode === "Area"
          ? "area"
          : "screen",
    );
    setPickedDisplay(selectedDisplay);
    setPickedWindow(selectedWindow ?? windows[0]?.id ?? null);
    setShareAudio(systemAudioEnabled);
    setAudioDevice(systemAudioDevice);

    void tauriService
      .getSystemAudioDevices()
      .then(setAudioDevices)
      .catch(() => setAudioDevices([]));
  }, [
    captureRegion,
    initialMode,
    isOpen,
    selectedDisplay,
    selectedWindow,
    systemAudioDevice,
    systemAudioEnabled,
    windows,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const canConfirm = tab === "window" ? Boolean(pickedWindow) : displays.length > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      capture_mode: tab === "window" ? "Window" : tab === "area" ? "Area" : "Screen",
      selected_display: pickedDisplay,
      selected_window: tab === "window" ? pickedWindow : selectedWindow,
      system_audio_enabled: shareAudio,
      system_audio_device: audioDevice,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm select-none"
      style={{ background: "var(--scrim)" }}
      onClick={onClose}
    >
      <div
        className="rf-pop-in flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Choose what to record
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-2)" }}>
              Confirm your capture source and system audio before starting.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRefreshSources}
              title="Refresh previews"
              className="rounded-lg p-1.5 transition-colors"
              style={{ color: "var(--text-2)" }}
            >
              <RefreshIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close source picker"
              className="rounded-lg p-1.5 transition-colors"
              style={{ color: "var(--text-2)" }}
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Source Tabs: Window / Entire Screen (+ Selected Area if present) */}
        <div
          className="flex items-center gap-2 px-5 pt-3.5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <button
            type="button"
            onClick={() => setTab("window")}
            className="inline-flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-xs font-semibold transition-colors"
            style={{
              borderColor: tab === "window" ? "var(--accent)" : "transparent",
              color: tab === "window" ? "var(--text)" : "var(--text-2)",
            }}
          >
            <AppWindowIcon className="h-3.5 w-3.5" />
            <span>Window</span>
            <span
              className="rounded-full px-1.5 py-px font-mono text-[10px]"
              style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
            >
              {windows.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab("screen")}
            className="inline-flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-xs font-semibold transition-colors"
            style={{
              borderColor: tab === "screen" ? "var(--accent)" : "transparent",
              color: tab === "screen" ? "var(--text)" : "var(--text-2)",
            }}
          >
            <MonitorIcon className="h-3.5 w-3.5" />
            <span>Entire Screen</span>
            <span
              className="rounded-full px-1.5 py-px font-mono text-[10px]"
              style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
            >
              {displays.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab("area")}
            className="inline-flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-xs font-semibold transition-colors"
            style={{
              borderColor: tab === "area" ? "var(--accent)" : "transparent",
              color: tab === "area" ? "var(--text)" : "var(--text-2)",
            }}
          >
            <CropIcon className="h-3.5 w-3.5" />
            <span>Custom Area</span>
          </button>
        </div>

        {/* Live Thumbnails Grid */}
        <div className="flex-1 overflow-y-auto p-5 rf-scroll">
          {tab === "screen" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {displays.map((d) => {
                const selected = pickedDisplay === d.index;
                const thumb = displayThumbnails[d.index];
                return (
                  <button
                    key={d.index}
                    type="button"
                    onClick={() => setPickedDisplay(d.index)}
                    className="group relative flex flex-col overflow-hidden rounded-xl p-2 text-left transition-all"
                    style={{
                      background: selected ? "var(--accent-soft)" : "var(--surface-2)",
                      border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    }}
                  >
                    <div
                      className="relative aspect-video w-full overflow-hidden rounded-lg"
                      style={{ background: "var(--inset)" }}
                    >
                      {thumb ? (
                        <img src={thumb} alt={d.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <MonitorIcon className="h-8 w-8" style={{ color: "var(--text-3)" }} />
                        </div>
                      )}
                      {selected && (
                        <span
                          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full shadow"
                          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                        >
                          <CheckIcon className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between px-1">
                      <span className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>
                        {d.name}
                      </span>
                      <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                        {d.width} × {d.height}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {tab === "window" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {windows.length === 0 ? (
                <div className="col-span-2 py-10 text-center text-xs" style={{ color: "var(--text-3)" }}>
                  No capturable windows detected. Open an application window and click Refresh.
                </div>
              ) : (
                windows.map((w) => {
                  const selected = pickedWindow === w.id;
                  const thumb = windowThumbnails[w.id];
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setPickedWindow(w.id)}
                      className="group relative flex flex-col overflow-hidden rounded-xl p-2 text-left transition-all"
                      style={{
                        background: selected ? "var(--accent-soft)" : "var(--surface-2)",
                        border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      <div
                        className="relative aspect-video w-full overflow-hidden rounded-lg flex items-center justify-center"
                        style={{ background: "var(--inset)" }}
                      >
                        {thumb ? (
                          <img src={thumb} alt={w.title} className="h-full w-full object-cover" />
                        ) : (
                          <AppWindowIcon className="h-8 w-8" style={{ color: "var(--text-3)" }} />
                        )}
                        {selected && (
                          <span
                            className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full shadow"
                            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                          >
                            <CheckIcon className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                      <div className="mt-2 px-1">
                        <div className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>
                          {w.title}
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
                          <span className="truncate font-mono">{w.process}</span>
                          <span className="font-mono">
                            {w.width} × {w.height}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {tab === "area" && (
            <div
              className="flex flex-col items-center justify-center gap-4 rounded-xl p-6 text-center"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            >
              <div
                className="flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                <CropIcon className="h-6 w-6" />
              </div>
              {captureRegion ? (
                <div>
                  <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                    Selected Capture Area
                  </div>
                  <div className="mt-1 font-mono text-xs" style={{ color: "var(--text-2)" }}>
                    {captureRegion.width} × {captureRegion.height} px at ({captureRegion.x},{" "}
                    {captureRegion.y})
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                    No capture area selected yet
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--text-2)" }}>
                    Click below to draw the exact screen region you want to record.
                  </div>
                </div>
              )}
              {onRequestPickArea && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRequestPickArea();
                  }}
                  className="rf-btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold"
                >
                  <CropIcon className="h-3.5 w-3.5" />
                  <span>{captureRegion ? "Select a different area…" : "Select area on screen…"}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer: Share with System Audio Toggle + Actions */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
          style={{
            background: "var(--bg-elev)",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2.5">
              <ToggleSwitch
                size="sm"
                checked={shareAudio}
                onChange={setShareAudio}
                label="Share with system audio"
              />
              <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--text)" }}>
                <SpeakerIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                Share with system audio
              </span>
            </label>

            {shareAudio && audioDevices.length > 0 && (
              <select
                value={audioDevice}
                onChange={(e) => setAudioDevice(e.target.value)}
                className="max-w-[200px] rounded-lg px-2 py-1 text-[11px] outline-none"
                style={{
                  background: "var(--inset)",
                  border: "1px solid var(--border)",
                  color: "var(--text-2)",
                }}
              >
                {audioDevices.map((d) => (
                  <option key={`${d.index}-${d.name}`} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-medium transition-colors"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text-2)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold shadow transition-opacity ${
                !canConfirm ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
              }`}
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              <RecordDotIcon className="h-3.5 w-3.5" />
              <span>Start recording</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
