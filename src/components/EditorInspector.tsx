import { useRef, useState } from "react";
import { STUDIO_BACKGROUNDS, type BackgroundCategory } from "../editor/backgrounds";
import {
  generateAutoZoomsFromClicks,
  getSnapPosition,
  ZOOM_PRESET_SCALES,
} from "../editor/canvasRenderer";
import type {
  AspectRatioId,
  CameraSnapPreset,
  EditorCameraShape,
  EditorProject,
  InspectorTab,
  ZoomIntensityPreset,
} from "../types";
import {
  BlurIcon,
  CameraIcon,
  FlipHorizontalIcon,
  LayoutIcon,
  MicIcon,
  PlusIcon,
  PointerIcon,
  RotateCcwIcon,
  SparklesIcon,
  SpeakerIcon,
  TrashIcon,
  UploadIcon,
  ZoomInIcon,
} from "./Icons";
import { ToggleSwitch } from "./ToggleSwitch";

type Props = {
  project: EditorProject;
  onChange: (updater: (prev: EditorProject) => EditorProject) => void;
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  currentTime: number;
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  selectedBlurId: string | null;
  onSelectBlur: (id: string | null) => void;
  onAddZoomAtPlayhead: (intensity: ZoomIntensityPreset) => void;
  onAddBlurRegion: () => void;
  onAttachCameraFile: (url: string) => void;
};

const TABS: { id: InspectorTab; label: string; Icon: typeof LayoutIcon }[] = [
  { id: "canvas", label: "Canvas", Icon: LayoutIcon },
  { id: "zoom", label: "Zoom", Icon: ZoomInIcon },
  { id: "cursor", label: "Cursor", Icon: PointerIcon },
  { id: "audio", label: "Audio", Icon: SpeakerIcon },
  { id: "camera", label: "Camera", Icon: CameraIcon },
  { id: "blur", label: "Blur", Icon: BlurIcon },
];

const ASPECT_PRESETS: { id: AspectRatioId; label: string; sub: string }[] = [
  { id: "16:9", label: "16:9", sub: "Landscape" },
  { id: "9:16", label: "9:16", sub: "Vertical" },
  { id: "1:1", label: "1:1", sub: "Square" },
  { id: "4:5", label: "4:5", sub: "Portrait" },
  { id: "original", label: "Original", sub: "Source" },
];

const SNAP_PRESETS: { id: CameraSnapPreset; label: string }[] = [
  { id: "top-left", label: "Top-Left" },
  { id: "top-right", label: "Top-Right" },
  { id: "bottom-left", label: "Bottom-Left" },
  { id: "bottom-right", label: "Bottom-Right" },
  { id: "center-bottom", label: "Center-Edge" },
  { id: "center-left", label: "Left-Edge" },
  { id: "center-right", label: "Right-Edge" },
];

const RIPPLE_COLORS = ["#ff6b4a", "#f59e0b", "#fb5678", "#f4729b", "#e879f9", "#fbbf24"];
const BORDER_COLORS = ["#ffffff", "#ff6b4a", "#f59e0b", "#f4729b", "#1c1515"];

export function EditorInspector({
  project,
  onChange,
  activeTab,
  onTabChange,
  currentTime,
  selectedZoomId,
  onSelectZoom,
  selectedBlurId,
  onSelectBlur,
  onAddZoomAtPlayhead,
  onAddBlurRegion,
  onAttachCameraFile,
}: Props) {
  const [bgFilter, setBgFilter] = useState<"all" | BackgroundCategory>("all");
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const camFileInputRef = useRef<HTMLInputElement>(null);

  const filteredBgs =
    bgFilter === "all"
      ? STUDIO_BACKGROUNDS
      : STUDIO_BACKGROUNDS.filter((b) => b.category === bgFilter);

  const selectedZoom = project.zooms.find((z) => z.id === selectedZoomId) ?? null;
  const selectedBlur = project.blurs.find((b) => b.id === selectedBlurId) ?? null;

  const handleUploadCustomBg = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onChange((p) => ({
          ...p,
          canvas: { ...p.canvas, customBackgroundUrl: reader.result as string },
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUploadCamVideo = (file: File | undefined) => {
    if (!file) return;
    onAttachCameraFile(URL.createObjectURL(file));
  };

  return (
    <aside
      className="flex h-full w-80 shrink-0 flex-col overflow-hidden select-none xl:w-[344px]"
      style={{
        background: "var(--bg-elev)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      {/* 6-Tab Inspector Header */}
      <div
        className="grid grid-cols-6 gap-0.5 p-1.5"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
      >
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className="flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold transition-all"
              style={
                active
                  ? {
                      background: "var(--accent-soft)",
                      color: "var(--accent)",
                    }
                  : { color: "var(--text-3)" }
              }
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Scrollable Inspector Body */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 rf-scroll">
        {/* ======================== CANVAS TAB ======================== */}
        {activeTab === "canvas" && (
          <>
            {/* Aspect Ratio Presets */}
            <section className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                Aspect ratio
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {ASPECT_PRESETS.map((preset) => {
                  const active = project.canvas.aspectRatio === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        onChange((p) => ({
                          ...p,
                          canvas: { ...p.canvas, aspectRatio: preset.id },
                        }))
                      }
                      className="rounded-xl px-2 py-2 text-left transition-all"
                      style={{
                        background: active ? "var(--accent-soft)" : "var(--surface)",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      <div
                        className="font-mono text-xs font-semibold"
                        style={{ color: active ? "var(--accent)" : "var(--text)" }}
                      >
                        {preset.label}
                      </div>
                      <div className="text-[10px]" style={{ color: "var(--text-3)" }}>
                        {preset.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Framing Mode (Fit vs Fill) */}
            <section className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                Framing
              </div>
              <div
                className="grid grid-cols-2 gap-1 rounded-xl p-1"
                style={{ background: "var(--inset)", border: "1px solid var(--border)" }}
              >
                {(
                  [
                    { id: "fit", label: "Fit", desc: "Show full frame" },
                    { id: "fill", label: "Fill", desc: "Edge-to-edge crop" },
                  ] as const
                ).map((mode) => {
                  const active = project.canvas.framing === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() =>
                        onChange((p) => ({ ...p, canvas: { ...p.canvas, framing: mode.id } }))
                      }
                      className="rounded-lg py-1.5 text-center text-xs font-semibold transition-all"
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
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Frame Geometry Sliders */}
            <section className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                Presentation Frame
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--text-2)" }}>Padding</span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                    {project.canvas.padding}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={16}
                  step={1}
                  value={project.canvas.padding}
                  onChange={(e) =>
                    onChange((p) => ({
                      ...p,
                      canvas: { ...p.canvas, padding: Number(e.target.value) },
                    }))
                  }
                  className="rf-slider w-full"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--text-2)" }}>Corner radius</span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                    {project.canvas.cornerRadius}px
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={36}
                  step={1}
                  value={project.canvas.cornerRadius}
                  onChange={(e) =>
                    onChange((p) => ({
                      ...p,
                      canvas: { ...p.canvas, cornerRadius: Number(e.target.value) },
                    }))
                  }
                  className="rf-slider w-full"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--text-2)" }}>Drop shadow</span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                    {project.canvas.shadow}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={project.canvas.shadow}
                  onChange={(e) =>
                    onChange((p) => ({
                      ...p,
                      canvas: { ...p.canvas, shadow: Number(e.target.value) },
                    }))
                  }
                  className="rf-slider w-full"
                />
              </div>
            </section>

            {/* Curated Backgrounds Grid + Custom Image Upload */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                  Backgrounds
                </span>
                <button
                  type="button"
                  onClick={() => bgFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: "var(--accent)",
                  }}
                >
                  <UploadIcon className="h-3 w-3" />
                  <span>Custom Image</span>
                </button>
                <input
                  ref={bgFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleUploadCustomBg(e.target.files?.[0])}
                />
              </div>

              {/* Category filter chips */}
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "gradient", label: "Gradients" },
                    { id: "abstract", label: "Abstract" },
                    { id: "scenic", label: "Scenic" },
                    { id: "solid", label: "Solid" },
                  ] as const
                ).map((cat) => {
                  const active = bgFilter === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setBgFilter(cat.id)}
                      className="rounded-md px-2 py-1 text-[10px] font-semibold transition-colors"
                      style={
                        active
                          ? { background: "var(--accent)", color: "var(--accent-fg)" }
                          : { background: "var(--surface)", color: "var(--text-3)" }
                      }
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              {project.canvas.customBackgroundUrl && (
                <div
                  className="flex items-center justify-between rounded-xl p-2"
                  style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)" }}
                >
                  <div className="flex items-center gap-2">
                    <img
                      src={project.canvas.customBackgroundUrl}
                      alt="Custom background"
                      className="h-7 w-11 rounded-md object-cover"
                    />
                    <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                      Custom image active
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onChange((p) => ({
                        ...p,
                        canvas: { ...p.canvas, customBackgroundUrl: null },
                      }))
                    }
                    className="rounded-md px-2 py-1 text-[11px] font-medium"
                    style={{ background: "var(--surface)", color: "var(--text-2)" }}
                  >
                    Remove
                  </button>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                {filteredBgs.map((bg) => {
                  const active =
                    !project.canvas.customBackgroundUrl && project.canvas.backgroundId === bg.id;
                  return (
                    <button
                      key={bg.id}
                      type="button"
                      title={bg.name}
                      onClick={() =>
                        onChange((p) => ({
                          ...p,
                          canvas: {
                            ...p.canvas,
                            backgroundId: bg.id,
                            customBackgroundUrl: null,
                          },
                        }))
                      }
                      className="group relative flex flex-col overflow-hidden rounded-xl transition-transform hover:scale-[1.02]"
                      style={{
                        border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      <div className="h-12 w-full" style={{ background: bg.css }} />
                      <span
                        className="truncate px-1.5 py-1 text-[10px] font-medium"
                        style={{ background: "var(--surface)", color: "var(--text-2)" }}
                      >
                        {bg.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {/* ======================== ZOOM TAB ======================== */}
        {activeTab === "zoom" && (
          <>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => onAddZoomAtPlayhead("balanced")}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold shadow-sm"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                <span>Add zoom at {currentTime.toFixed(1)}s</span>
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const generated = generateAutoZoomsFromClicks(
                      project.cursorTrack,
                      project.duration,
                      "balanced",
                    );
                    if (generated.length > 0) {
                      onChange((p) => ({ ...p, zooms: generated }));
                      onSelectZoom(generated[0].id);
                    }
                  }}
                  disabled={!project.cursorTrack?.clicks?.length}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-semibold disabled:opacity-45"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                >
                  <SparklesIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                  <span>Auto from clicks ({project.cursorTrack?.clicks?.length ?? 0})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange((p) => ({ ...p, zooms: [] }));
                    onSelectZoom(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-[11px] font-medium"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text-2)",
                  }}
                >
                  <RotateCcwIcon className="h-3 w-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {selectedZoom ? (
              <div
                className="space-y-3 rounded-2xl p-3.5"
                style={{ background: "var(--surface)", border: "1px solid var(--accent)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                    Selected Zoom Keyframe
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onChange((p) => ({
                        ...p,
                        zooms: p.zooms.filter((z) => z.id !== selectedZoom.id),
                      }));
                      onSelectZoom(null);
                    }}
                    className="rounded-md p-1"
                    style={{ color: "var(--danger)" }}
                    title="Delete zoom keyframe"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Intensity presets */}
                <div
                  className="grid grid-cols-3 gap-1 rounded-lg p-1"
                  style={{ background: "var(--inset)" }}
                >
                  {(["subtle", "balanced", "close"] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        onChange((p) => ({
                          ...p,
                          zooms: p.zooms.map((z) =>
                            z.id === selectedZoom.id
                              ? { ...z, intensity: preset, scale: ZOOM_PRESET_SCALES[preset] }
                              : z,
                          ),
                        }))
                      }
                      className="rounded-md py-1 text-[11px] font-semibold capitalize"
                      style={
                        selectedZoom.intensity === preset
                          ? { background: "var(--accent)", color: "var(--accent-fg)" }
                          : { color: "var(--text-2)" }
                      }
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--text-2)" }}>Magnification</span>
                    <span className="font-mono text-[11px]" style={{ color: "var(--accent)" }}>
                      {selectedZoom.scale.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.15}
                    max={3.0}
                    step={0.05}
                    value={selectedZoom.scale}
                    onChange={(e) =>
                      onChange((p) => ({
                        ...p,
                        zooms: p.zooms.map((z) =>
                          z.id === selectedZoom.id ? { ...z, scale: Number(e.target.value) } : z,
                        ),
                      }))
                    }
                    className="rf-slider w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                      Start (s)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, project.duration - 0.3)}
                      step={0.1}
                      value={selectedZoom.start}
                      onChange={(e) =>
                        onChange((p) => ({
                          ...p,
                          zooms: p.zooms.map((z) =>
                            z.id === selectedZoom.id
                              ? { ...z, start: Math.max(0, Number(e.target.value) || 0) }
                              : z,
                          ),
                        }))
                      }
                      className="w-full rounded-lg px-2 py-1.5 font-mono text-xs"
                      style={{
                        background: "var(--inset)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                      Duration (s)
                    </span>
                    <input
                      type="number"
                      min={0.4}
                      max={project.duration}
                      step={0.1}
                      value={selectedZoom.duration}
                      onChange={(e) =>
                        onChange((p) => ({
                          ...p,
                          zooms: p.zooms.map((z) =>
                            z.id === selectedZoom.id
                              ? { ...z, duration: Math.max(0.4, Number(e.target.value) || 0.5) }
                              : z,
                          ),
                        }))
                      }
                      className="w-full rounded-lg px-2 py-1.5 font-mono text-xs"
                      style={{
                        background: "var(--inset)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
                      <span>Focus X</span>
                      <span className="font-mono">{Math.round(selectedZoom.focusX * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.01}
                      value={selectedZoom.focusX}
                      onChange={(e) =>
                        onChange((p) => ({
                          ...p,
                          zooms: p.zooms.map((z) =>
                            z.id === selectedZoom.id ? { ...z, focusX: Number(e.target.value) } : z,
                          ),
                        }))
                      }
                      className="rf-slider w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
                      <span>Focus Y</span>
                      <span className="font-mono">{Math.round(selectedZoom.focusY * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.01}
                      value={selectedZoom.focusY}
                      onChange={(e) =>
                        onChange((p) => ({
                          ...p,
                          zooms: p.zooms.map((z) =>
                            z.id === selectedZoom.id ? { ...z, focusY: Number(e.target.value) } : z,
                          ),
                        }))
                      }
                      className="rf-slider w-full"
                    />
                  </div>
                </div>

                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  Tip: Click anywhere on the canvas preview to aim this zoom focus point.
                </p>
              </div>
            ) : (
              <div
                className="rounded-xl p-3 text-xs"
                style={{ background: "var(--surface)", color: "var(--text-2)", border: "1px solid var(--border)" }}
              >
                Click any zoom segment below or on the timeline to fine-tune its focus point and magnification.
              </div>
            )}

            {/* Keyframes list */}
            <section className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                Zoom Keyframes ({project.zooms.length})
              </div>
              {project.zooms.length === 0 ? (
                <div className="text-xs" style={{ color: "var(--text-3)" }}>
                  No zoom keyframes added yet.
                </div>
              ) : (
                project.zooms.map((z, idx) => {
                  const active = z.id === selectedZoomId;
                  return (
                    <button
                      key={z.id}
                      type="button"
                      onClick={() => onSelectZoom(z.id)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors"
                      style={{
                        background: active ? "var(--accent-soft)" : "var(--surface)",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      <div>
                        <span className="font-semibold" style={{ color: "var(--text)" }}>
                          Zoom #{idx + 1}
                        </span>
                        <span className="ml-2 font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                          {z.start.toFixed(1)}s – {(z.start + z.duration).toFixed(1)}s
                        </span>
                      </div>
                      <span className="font-mono text-[11px] font-semibold" style={{ color: "var(--accent)" }}>
                        {z.scale.toFixed(1)}×
                      </span>
                    </button>
                  );
                })
              )}
            </section>
          </>
        )}

        {/* ======================== CURSOR TAB ======================== */}
        {activeTab === "cursor" && (
          <div className="space-y-4">
            <div
              className="flex items-center justify-between rounded-xl p-3"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div>
                <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                  Enhanced studio cursor
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  {project.cursorTrack?.samples?.length
                    ? `${project.cursorTrack.samples.length} tracked positions · ${project.cursorTrack.clicks.length} clicks`
                    : "No cursor track data in this file"}
                </div>
              </div>
              <ToggleSwitch
                checked={project.cursor.enabled}
                onChange={(enabled) => onChange((p) => ({ ...p, cursor: { ...p.cursor, enabled } }))}
                label="Toggle studio cursor overlay"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span style={{ color: "var(--text-2)" }}>Cursor size</span>
                <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                  {project.cursor.scale.toFixed(2)}×
                </span>
              </div>
              <input
                type="range"
                min={0.8}
                max={2.4}
                step={0.05}
                disabled={!project.cursor.enabled}
                value={project.cursor.scale}
                onChange={(e) =>
                  onChange((p) => ({
                    ...p,
                    cursor: { ...p.cursor, scale: Number(e.target.value) },
                  }))
                }
                className="rf-slider w-full"
              />
            </div>

            <div
              className="space-y-3 rounded-xl p-3"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  Click ripple animation
                </span>
                <ToggleSwitch
                  size="sm"
                  disabled={!project.cursor.enabled}
                  checked={project.cursor.clickRipple}
                  onChange={(clickRipple) =>
                    onChange((p) => ({ ...p, cursor: { ...p.cursor, clickRipple } }))
                  }
                  label="Toggle click ripple"
                />
              </div>

              {project.cursor.clickRipple && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                    Color
                  </span>
                  <div className="flex items-center gap-1.5">
                    {RIPPLE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          onChange((p) => ({ ...p, cursor: { ...p.cursor, rippleColor: c } }))
                        }
                        className="h-5 w-5 rounded-full transition-transform hover:scale-110"
                        style={{
                          background: c,
                          outline:
                            project.cursor.rippleColor === c ? "2px solid var(--text)" : "none",
                          outlineOffset: 2,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  Cursor spotlight halo
                </span>
                <ToggleSwitch
                  size="sm"
                  disabled={!project.cursor.enabled}
                  checked={project.cursor.highlightHalo}
                  onChange={(highlightHalo) =>
                    onChange((p) => ({ ...p, cursor: { ...p.cursor, highlightHalo } }))
                  }
                  label="Toggle cursor spotlight halo"
                />
              </div>

              <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  Smooth cursor motion
                </span>
                <ToggleSwitch
                  size="sm"
                  disabled={!project.cursor.enabled}
                  checked={project.cursor.smoothMotion}
                  onChange={(smoothMotion) =>
                    onChange((p) => ({ ...p, cursor: { ...p.cursor, smoothMotion } }))
                  }
                  label="Toggle smooth cursor motion"
                />
              </div>
            </div>
          </div>
        )}

        {/* ======================== AUDIO TAB ======================== */}
        {activeTab === "audio" && (
          <div className="space-y-4">
            {/* Master Output */}
            <div
              className="space-y-2.5 rounded-xl p-3.5"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                  Master Gain
                </span>
                <span className="font-mono text-xs" style={{ color: "var(--accent)" }}>
                  {Math.round(project.audio.masterVolume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={project.audio.masterVolume}
                onChange={(e) =>
                  onChange((p) => ({
                    ...p,
                    audio: { ...p.audio, masterVolume: Number(e.target.value) },
                  }))
                }
                className="rf-slider w-full"
              />
            </div>

            {/* Microphone Balance */}
            <div
              className="space-y-2.5 rounded-xl p-3.5"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text)" }}>
                  <MicIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                  Microphone Mix
                </span>
                <ToggleSwitch
                  size="sm"
                  checked={!project.audio.micMuted}
                  onChange={(on) =>
                    onChange((p) => ({ ...p, audio: { ...p.audio, micMuted: !on } }))
                  }
                  label="Enable microphone track"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  disabled={project.audio.micMuted}
                  value={project.audio.micVolume}
                  onChange={(e) =>
                    onChange((p) => ({
                      ...p,
                      audio: { ...p.audio, micVolume: Number(e.target.value) },
                    }))
                  }
                  className="rf-slider flex-1"
                />
                <span className="w-10 text-right font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                  {Math.round(project.audio.micVolume * 100)}%
                </span>
              </div>
            </div>

            {/* System Audio Balance */}
            <div
              className="space-y-2.5 rounded-xl p-3.5"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--text)" }}>
                  <SpeakerIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                  System Audio Mix
                </span>
                <ToggleSwitch
                  size="sm"
                  checked={!project.audio.systemMuted}
                  onChange={(on) =>
                    onChange((p) => ({ ...p, audio: { ...p.audio, systemMuted: !on } }))
                  }
                  label="Enable system audio track"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  disabled={project.audio.systemMuted}
                  value={project.audio.systemVolume}
                  onChange={(e) =>
                    onChange((p) => ({
                      ...p,
                      audio: { ...p.audio, systemVolume: Number(e.target.value) },
                    }))
                  }
                  className="rf-slider flex-1"
                />
                <span className="w-10 text-right font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                  {Math.round(project.audio.systemVolume * 100)}%
                </span>
              </div>
            </div>

            {/* Transitions */}
            <div
              className="space-y-3 rounded-xl p-3.5"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  Smooth audio fade-in
                </span>
                <ToggleSwitch
                  size="sm"
                  checked={project.audio.fadeIn}
                  onChange={(fadeIn) => onChange((p) => ({ ...p, audio: { ...p.audio, fadeIn } }))}
                  label="Toggle audio fade-in"
                />
              </div>
              <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  Smooth audio fade-out
                </span>
                <ToggleSwitch
                  size="sm"
                  checked={project.audio.fadeOut}
                  onChange={(fadeOut) =>
                    onChange((p) => ({ ...p, audio: { ...p.audio, fadeOut } }))
                  }
                  label="Toggle audio fade-out"
                />
              </div>
            </div>
          </div>
        )}

        {/* ======================== CAMERA TAB ======================== */}
        {activeTab === "camera" && (
          <div className="space-y-4">
            <div
              className="flex items-center justify-between rounded-xl p-3"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div>
                <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                  Camera overlay
                </div>
                <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  {project.cameraUrl
                    ? "Independent synced webcam layer"
                    : "No camera stream in this recording"}
                </div>
              </div>
              <ToggleSwitch
                checked={project.camera.enabled}
                disabled={!project.cameraUrl}
                onChange={(enabled) => onChange((p) => ({ ...p, camera: { ...p.camera, enabled } }))}
                label="Toggle webcam overlay"
              />
            </div>

            {!project.cameraUrl && (
              <div
                className="rounded-xl p-3.5 text-center space-y-2"
                style={{ background: "var(--inset)", border: "1px dashed var(--border-strong)" }}
              >
                <p className="text-xs" style={{ color: "var(--text-2)" }}>
                  Enable Camera before recording to capture an independent webcam track, or import one now:
                </p>
                <button
                  type="button"
                  onClick={() => camFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
                  style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                >
                  <UploadIcon className="h-3.5 w-3.5" />
                  <span>Attach camera video</span>
                </button>
                <input
                  ref={camFileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => handleUploadCamVideo(e.target.files?.[0])}
                />
              </div>
            )}

            {/* Quick-Snap Position Buttons */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                  Quick-snap position
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
                  Or drag on canvas
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {SNAP_PRESETS.map((snap) => {
                  const pos = getSnapPosition(snap.id);
                  const active =
                    Math.abs(project.camera.x - pos.x) < 0.04 &&
                    Math.abs(project.camera.y - pos.y) < 0.04;
                  return (
                    <button
                      key={snap.id}
                      type="button"
                      disabled={!project.camera.enabled}
                      onClick={() =>
                        onChange((p) => ({
                          ...p,
                          camera: { ...p.camera, x: pos.x, y: pos.y },
                        }))
                      }
                      className="rounded-lg px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-45"
                      style={{
                        background: active ? "var(--accent-soft)" : "var(--surface)",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                        color: active ? "var(--accent)" : "var(--text-2)",
                      }}
                    >
                      {snap.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Shape Selector */}
            <section className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                Shape
              </div>
              <div
                className="grid grid-cols-3 gap-1 rounded-xl p-1"
                style={{ background: "var(--inset)", border: "1px solid var(--border)" }}
              >
                {(
                  [
                    { id: "circle", label: "Circle" },
                    { id: "rounded", label: "Rounded" },
                    { id: "square", label: "Square" },
                  ] as { id: EditorCameraShape; label: string }[]
                ).map((sh) => {
                  const active = project.camera.shape === sh.id;
                  return (
                    <button
                      key={sh.id}
                      type="button"
                      disabled={!project.camera.enabled}
                      onClick={() =>
                        onChange((p) => ({ ...p, camera: { ...p.camera, shape: sh.id } }))
                      }
                      className="rounded-lg py-1.5 text-xs font-semibold disabled:opacity-45"
                      style={
                        active
                          ? { background: "var(--surface-2)", color: "var(--text)", boxShadow: "var(--shadow-sm)" }
                          : { color: "var(--text-2)" }
                      }
                    >
                      {sh.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Size, Corner Radius, Border, Shadow, Mirror */}
            <section className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--text-2)" }}>Camera size</span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                    {Math.round(project.camera.scale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.12}
                  max={0.44}
                  step={0.01}
                  disabled={!project.camera.enabled}
                  value={project.camera.scale}
                  onChange={(e) =>
                    onChange((p) => ({
                      ...p,
                      camera: { ...p.camera, scale: Number(e.target.value) },
                    }))
                  }
                  className="rf-slider w-full"
                />
              </div>

              {project.camera.shape === "rounded" && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--text-2)" }}>Corner radius</span>
                    <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                      {project.camera.cornerRadius}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={6}
                    max={48}
                    step={2}
                    disabled={!project.camera.enabled}
                    value={project.camera.cornerRadius}
                    onChange={(e) =>
                      onChange((p) => ({
                        ...p,
                        camera: { ...p.camera, cornerRadius: Number(e.target.value) },
                      }))
                    }
                    className="rf-slider w-full"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--text-2)" }}>Border thickness</span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                    {project.camera.borderWidth}px
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  disabled={!project.camera.enabled}
                  value={project.camera.borderWidth}
                  onChange={(e) =>
                    onChange((p) => ({
                      ...p,
                      camera: { ...p.camera, borderWidth: Number(e.target.value) },
                    }))
                  }
                  className="rf-slider w-full"
                />
                {project.camera.borderWidth > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                      Border color
                    </span>
                    <div className="flex items-center gap-1.5">
                      {BORDER_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() =>
                            onChange((p) => ({ ...p, camera: { ...p.camera, borderColor: c } }))
                          }
                          className="h-5 w-5 rounded-full border border-black/30"
                          style={{
                            background: c,
                            outline:
                              project.camera.borderColor === c ? "2px solid var(--accent)" : "none",
                            outlineOffset: 2,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--text-2)" }}>Shadow depth</span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                    {project.camera.shadow}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  disabled={!project.camera.enabled}
                  value={project.camera.shadow}
                  onChange={(e) =>
                    onChange((p) => ({
                      ...p,
                      camera: { ...p.camera, shadow: Number(e.target.value) },
                    }))
                  }
                  className="rf-slider w-full"
                />
              </div>

              <div
                className="flex items-center justify-between rounded-xl p-3"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--text)" }}>
                  <FlipHorizontalIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                  Mirror horizontally
                </span>
                <ToggleSwitch
                  size="sm"
                  disabled={!project.camera.enabled}
                  checked={project.camera.mirror}
                  onChange={(mirror) =>
                    onChange((p) => ({ ...p, camera: { ...p.camera, mirror } }))
                  }
                  label="Mirror camera horizontally"
                />
              </div>
            </section>
          </div>
        )}

        {/* ======================== BLUR TAB ======================== */}
        {activeTab === "blur" && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={onAddBlurRegion}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold shadow-sm"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span>Add blur region</span>
            </button>

            {selectedBlur && (
              <div
                className="space-y-3 rounded-2xl p-3.5"
                style={{ background: "var(--surface)", border: "1px solid var(--accent)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                    {selectedBlur.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onChange((p) => ({
                        ...p,
                        blurs: p.blurs.filter((b) => b.id !== selectedBlur.id),
                      }));
                      onSelectBlur(null);
                    }}
                    className="rounded-md p-1"
                    style={{ color: "var(--danger)" }}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--text-2)" }}>Blur intensity</span>
                    <span className="font-mono text-[11px]" style={{ color: "var(--accent)" }}>
                      {selectedBlur.intensity}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={6}
                    max={36}
                    step={2}
                    value={selectedBlur.intensity}
                    onChange={(e) =>
                      onChange((p) => ({
                        ...p,
                        blurs: p.blurs.map((b) =>
                          b.id === selectedBlur.id
                            ? { ...b, intensity: Number(e.target.value) }
                            : b,
                        ),
                      }))
                    }
                    className="rf-slider w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
                      <span>Width</span>
                      <span className="font-mono">{Math.round(selectedBlur.width * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={0.8}
                      step={0.01}
                      value={selectedBlur.width}
                      onChange={(e) =>
                        onChange((p) => ({
                          ...p,
                          blurs: p.blurs.map((b) =>
                            b.id === selectedBlur.id
                              ? { ...b, width: Number(e.target.value) }
                              : b,
                          ),
                        }))
                      }
                      className="rf-slider w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]" style={{ color: "var(--text-3)" }}>
                      <span>Height</span>
                      <span className="font-mono">{Math.round(selectedBlur.height * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.04}
                      max={0.8}
                      step={0.01}
                      value={selectedBlur.height}
                      onChange={(e) =>
                        onChange((p) => ({
                          ...p,
                          blurs: p.blurs.map((b) =>
                            b.id === selectedBlur.id
                              ? { ...b, height: Number(e.target.value) }
                              : b,
                          ),
                        }))
                      }
                      className="rf-slider w-full"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs" style={{ color: "var(--text-2)" }}>
                    Keep active for entire clip
                  </span>
                  <ToggleSwitch
                    size="sm"
                    checked={selectedBlur.alwaysVisible}
                    onChange={(alwaysVisible) =>
                      onChange((p) => ({
                        ...p,
                        blurs: p.blurs.map((b) =>
                          b.id === selectedBlur.id ? { ...b, alwaysVisible } : b,
                        ),
                      }))
                    }
                    label="Keep blur active for entire clip"
                  />
                </div>

                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  Drag the blur rectangle directly on the canvas to redact passwords, keys, or personal data.
                </p>
              </div>
            )}

            <section className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                Active Blur Regions ({project.blurs.length})
              </div>
              {project.blurs.length === 0 ? (
                <div
                  className="rounded-xl p-3 text-xs"
                  style={{ background: "var(--surface)", color: "var(--text-3)", border: "1px solid var(--border)" }}
                >
                  Hide sensitive information by adding a privacy blur box.
                </div>
              ) : (
                project.blurs.map((b) => {
                  const active = b.id === selectedBlurId;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onSelectBlur(b.id)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs"
                      style={{
                        background: active ? "var(--accent-soft)" : "var(--surface)",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      <span className="font-medium" style={{ color: "var(--text)" }}>
                        {b.label}
                      </span>
                      <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
                        {b.intensity}px
                      </span>
                    </button>
                  );
                })
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
