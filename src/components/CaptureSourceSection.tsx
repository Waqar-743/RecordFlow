import { useMemo, useState } from "react";
import type { CaptureMode, CaptureRegion, DisplayInfo, WindowInfo } from "../types";
import { AppWindowIcon, CropIcon, MonitorIcon, RefreshIcon } from "./Icons";
import { SectionWrapper } from "./SectionWrapper";

type Props = {
  captureMode: CaptureMode;
  onCaptureModeChange: (mode: CaptureMode) => void;
  displays: DisplayInfo[];
  selectedDisplay: number;
  onSelectDisplay: (index: number) => void;
  displayThumbnails: Record<number, string>;
  onRefreshThumbnails: () => void;
  thumbnailsLoading: boolean;
  captureRegion: CaptureRegion | null;
  onPickArea: () => void;
  onClearArea: () => void;
  windows: WindowInfo[];
  selectedWindow: string | null;
  onSelectWindow: (windowId: string) => void;
  onRefreshWindows: () => void;
  windowsLoading: boolean;
  disabled?: boolean;
};

export function CaptureSourceSection({
  captureMode,
  onCaptureModeChange,
  displays,
  selectedDisplay,
  onSelectDisplay,
  displayThumbnails,
  onRefreshThumbnails,
  thumbnailsLoading,
  captureRegion,
  onPickArea,
  onClearArea,
  windows,
  selectedWindow,
  onSelectWindow,
  onRefreshWindows,
  windowsLoading,
  disabled = false,
}: Props) {
  const [windowQuery, setWindowQuery] = useState("");

  const activeDisplay = useMemo(
    () => displays.find((d) => d.index === selectedDisplay) ?? displays[0] ?? null,
    [displays, selectedDisplay],
  );

  const activeWindow = useMemo(
    () => windows.find((w) => w.id === selectedWindow) ?? null,
    [selectedWindow, windows],
  );

  const filteredWindows = useMemo(() => {
    const q = windowQuery.trim().toLowerCase();
    if (!q) return windows;
    return windows.filter(
      (w) => w.title.toLowerCase().includes(q) || w.process.toLowerCase().includes(q),
    );
  }, [windowQuery, windows]);

  const activeThumb = activeDisplay ? displayThumbnails[activeDisplay.index] : undefined;

  const regionOverlayStyle = useMemo(() => {
    if (!captureRegion || !activeDisplay || activeDisplay.width <= 0 || activeDisplay.height <= 0) {
      return null;
    }
    return {
      left: `${(captureRegion.x / activeDisplay.width) * 100}%`,
      top: `${(captureRegion.y / activeDisplay.height) * 100}%`,
      width: `${(captureRegion.width / activeDisplay.width) * 100}%`,
      height: `${(captureRegion.height / activeDisplay.height) * 100}%`,
    };
  }, [activeDisplay, captureRegion]);

  const modeTabs: { id: CaptureMode; label: string; icon: typeof MonitorIcon }[] = [
    { id: "Screen", label: "Full Screen", icon: MonitorIcon },
    { id: "Area", label: "Custom Area", icon: CropIcon },
    { id: "Window", label: "Window", icon: AppWindowIcon },
  ];

  return (
    <SectionWrapper
      title="Capture Source"
      subtitle={
        captureMode === "Screen"
          ? activeDisplay
            ? `${activeDisplay.name} · ${activeDisplay.width} × ${activeDisplay.height}`
            : "Choose a display to record"
          : captureMode === "Area"
            ? captureRegion
              ? `${captureRegion.width} × ${captureRegion.height} region on ${activeDisplay?.name ?? "Display"}`
              : "Draw any area on your screen with precision handles"
            : activeWindow
              ? `${activeWindow.title} (${activeWindow.width} × ${activeWindow.height})`
              : "Record a single application window directly"
      }
      icon={<MonitorIcon className="h-4 w-4" />}
      headerRight={
        <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
          {modeTabs.map((tab) => {
            const Icon = tab.icon;
            const active = captureMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={disabled}
                onClick={() => onCaptureModeChange(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 ${
                  active
                    ? "bg-indigo-500 text-white shadow-sm shadow-indigo-500/30"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      }
    >
      {captureMode !== "Window" ? (
        <div className="space-y-4">
          {/* Display Preview Frame */}
          <div className="group relative aspect-video w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            {activeThumb ? (
              <img
                src={activeThumb}
                alt={activeDisplay?.name ?? "Display preview"}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-500">
                <MonitorIcon className="h-8 w-8 opacity-60" />
                <span className="text-xs">
                  {activeDisplay
                    ? `${activeDisplay.name} (${activeDisplay.width} × ${activeDisplay.height})`
                    : "No display detected"}
                </span>
              </div>
            )}

            {/* Selected Area Overlay on Thumbnail */}
            {captureMode === "Area" && regionOverlayStyle && (
              <div
                className="pointer-events-none absolute rounded-sm border-2 border-sky-400 bg-sky-400/10 shadow-[0_0_0_9999px_rgba(9,9,11,0.58)]"
                style={regionOverlayStyle}
              >
                <span className="absolute left-1.5 top-1.5 rounded bg-zinc-950/90 px-1.5 py-0.5 font-mono text-[10px] font-medium text-sky-300 border border-sky-400/30">
                  {captureRegion!.width} × {captureRegion!.height}
                </span>
              </div>
            )}

            {/* Top-left Status Badge */}
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] font-medium text-zinc-200 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>{activeDisplay?.name ?? "No Display"}</span>
              {activeDisplay && (
                <span className="font-mono text-zinc-400">
                  {activeDisplay.width}×{activeDisplay.height}
                </span>
              )}
            </div>

            {/* Top-right Refresh Preview */}
            <button
              type="button"
              disabled={disabled || thumbnailsLoading}
              onClick={onRefreshThumbnails}
              title="Refresh screen preview"
              className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300 backdrop-blur-md transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
            >
              <RefreshIcon className={`h-3 w-3 ${thumbnailsLoading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>

            {/* Area Action Overlay */}
            {captureMode === "Area" && (
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-zinc-950/85 px-3 py-2 backdrop-blur-md">
                <div className="flex items-center gap-2 text-xs text-zinc-300 min-w-0">
                  <CropIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  {captureRegion ? (
                    <span className="truncate">
                      Area:{" "}
                      <span className="font-mono font-semibold text-white">
                        {captureRegion.width} × {captureRegion.height}
                      </span>{" "}
                      <span className="text-zinc-500">
                        at ({captureRegion.x}, {captureRegion.y})
                      </span>
                    </span>
                  ) : (
                    <span className="text-amber-300">No area selected yet — click Select Area</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {captureRegion && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={onClearArea}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-40"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={disabled || !activeDisplay}
                    onClick={onPickArea}
                    className="rounded-lg bg-sky-500 px-3 py-1 text-xs font-semibold text-zinc-950 shadow-sm transition-colors hover:bg-sky-400 disabled:opacity-40"
                  >
                    {captureRegion ? "Adjust Area" : "Select Area"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Multi-Monitor Strip */}
          {displays.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Displays ({displays.length})
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {displays.map((d) => {
                  const isSelected = d.index === (activeDisplay?.index ?? 0);
                  const thumb = displayThumbnails[d.index];
                  return (
                    <button
                      key={d.index}
                      type="button"
                      disabled={disabled}
                      onClick={() => onSelectDisplay(d.index)}
                      className={`flex items-center gap-3 rounded-xl border p-2.5 text-left transition-all disabled:opacity-50 ${
                        isSelected
                          ? "border-indigo-500/80 bg-indigo-500/10 ring-1 ring-indigo-500/30"
                          : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-900/70"
                      }`}
                    >
                      <div className="h-10 w-16 shrink-0 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-zinc-600">
                            <MonitorIcon className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-zinc-100">
                            {d.name.replace(" (Primary)", "")}
                          </span>
                          {d.is_primary && (
                            <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
                              Primary
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
                          {d.width} × {d.height}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Window Picker Mode */
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={windowQuery}
              onChange={(e) => setWindowQuery(e.target.value)}
              placeholder="Filter open windows by title or app..."
              disabled={disabled}
              className="h-9 flex-1 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              disabled={disabled || windowsLoading}
              onClick={onRefreshWindows}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white disabled:opacity-50"
            >
              <RefreshIcon className={`h-3.5 w-3.5 ${windowsLoading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
            {filteredWindows.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 py-10 text-center">
                <AppWindowIcon className="mb-2 h-6 w-6 text-zinc-600" />
                <p className="text-xs font-medium text-zinc-400">
                  {windowsLoading
                    ? "Scanning open windows..."
                    : "No capturable windows found"}
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Make sure the target app is open and not minimized, then click Refresh.
                </p>
              </div>
            ) : (
              filteredWindows.map((win) => {
                const isSelected = selectedWindow === win.id;
                return (
                  <button
                    key={win.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelectWindow(win.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all disabled:opacity-50 ${
                      isSelected
                        ? "border-indigo-500/80 bg-indigo-500/12 text-white ring-1 ring-indigo-500/30"
                        : "border-zinc-800/80 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/70"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isSelected ? "bg-indigo-500/20 text-indigo-300" : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      <AppWindowIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-zinc-100">{win.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                        {win.process && (
                          <span className="rounded bg-zinc-800/90 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
                            {win.process}
                          </span>
                        )}
                        <span className="font-mono">
                          {win.width} × {win.height}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="shrink-0 rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Selected
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </SectionWrapper>
  );
}
