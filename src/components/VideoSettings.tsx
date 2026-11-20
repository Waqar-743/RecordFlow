import type { CaptureMode, CaptureRegion, DisplayInfo, Resolution, WindowInfo } from "../types";
import { CursorIcon, VideoIcon } from "./Icons";
import { SectionWrapper, ToggleSwitch } from "./SectionWrapper";

type Props = {
  captureMode: CaptureMode;
  activeDisplay: DisplayInfo | null;
  activeWindow: WindowInfo | null;
  captureRegion: CaptureRegion | null;
  selectedResolution: Resolution;
  fps: number;
  bitrate: number;
  captureCursor: boolean;
  disabled?: boolean;
  onResolutionChange: (resolution: Resolution) => void;
  onFpsChange: (fps: number) => void;
  onBitrateChange: (bitrate: number) => void;
  onCaptureCursorChange: (enabled: boolean) => void;
};

const RESOLUTIONS: { value: Resolution; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "Native", label: "Native" },
];

const FPS_OPTIONS = [30, 60];

const QUALITY_PRESETS = [
  { label: "Standard", sub: "5 Mbps", bitrate: 5000 },
  { label: "High", sub: "8 Mbps", bitrate: 8000 },
  { label: "Ultra", sub: "14 Mbps", bitrate: 14000 },
];

export function VideoSettings({
  captureMode,
  activeDisplay,
  activeWindow,
  captureRegion,
  selectedResolution,
  fps,
  bitrate,
  captureCursor,
  disabled = false,
  onResolutionChange,
  onFpsChange,
  onBitrateChange,
  onCaptureCursorChange,
}: Props) {
  const outputLabel = (() => {
    if (captureMode === "Area") {
      return captureRegion ? `${captureRegion.width} × ${captureRegion.height} (Area)` : "Selected area";
    }
    if (captureMode === "Window" && activeWindow) {
      if (selectedResolution === "Native") return `${activeWindow.width} × ${activeWindow.height}`;
      return `Up to ${selectedResolution} (${activeWindow.width} × ${activeWindow.height})`;
    }
    if (selectedResolution === "720p") return "1280 × 720";
    if (selectedResolution === "1080p") return "1920 × 1080";
    return activeDisplay ? `${activeDisplay.width} × ${activeDisplay.height}` : "Native";
  })();

  const activeBitrate = QUALITY_PRESETS.reduce((closest, preset) =>
    Math.abs(preset.bitrate - bitrate) < Math.abs(closest.bitrate - bitrate) ? preset : closest,
  ).bitrate;

  return (
    <SectionWrapper
      title="Video & Encoding"
      subtitle="Hardware-first H.264 MP4 with automatic software fallback"
      icon={<VideoIcon className="h-4 w-4" />}
      headerRight={
        <span className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-2.5 py-1 font-mono text-[11px] text-zinc-300">
          {outputLabel} · {fps}fps · {(bitrate / 1000).toFixed(0)} Mbps
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Resolution */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Resolution
            </label>
            {captureMode === "Area" && (
              <span className="text-[10px] text-sky-400">Matches area</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
            {RESOLUTIONS.map((opt) => {
              const active = selectedResolution === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled || captureMode === "Area"}
                  onClick={() => onResolutionChange(opt.value)}
                  className={`rounded-lg py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? "bg-zinc-800 text-white shadow-sm ring-1 ring-zinc-700"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Frame Rate */}
        <div className="space-y-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Frame Rate
          </label>
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
            {FPS_OPTIONS.map((value) => {
              const active = fps === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onFpsChange(value)}
                  className={`rounded-lg py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? "bg-indigo-500 text-white shadow-sm shadow-indigo-500/30"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {value} fps
                </button>
              );
            })}
          </div>
        </div>

        {/* Quality / Bitrate */}
        <div className="space-y-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            Quality
          </label>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
            {QUALITY_PRESETS.map((preset) => {
              const active = activeBitrate === preset.bitrate;
              return (
                <button
                  key={preset.label}
                  type="button"
                  disabled={disabled}
                  onClick={() => onBitrateChange(preset.bitrate)}
                  title={preset.sub}
                  className={`rounded-lg py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? "bg-zinc-800 text-white shadow-sm ring-1 ring-zinc-700"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Cursor Capture Row */}
      <div className="mt-4 flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3.5 py-2.5">
        <div className="flex items-center gap-2.5">
          <CursorIcon className="h-4 w-4 text-zinc-400" />
          <div>
            <div className="text-xs font-medium text-zinc-200">Capture mouse cursor</div>
            <div className="text-[11px] text-zinc-500">
              Show your pointer in the recorded video
            </div>
          </div>
        </div>
        <ToggleSwitch
          checked={captureCursor}
          onChange={onCaptureCursorChange}
          disabled={disabled}
          label="Capture mouse cursor"
        />
      </div>
    </SectionWrapper>
  );
}
