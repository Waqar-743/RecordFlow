import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { EditorProject, ZoomIntensityPreset } from "../types";
import {
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  ScissorsIcon,
  ZoomInIcon,
} from "./Icons";

type Props = {
  project: EditorProject;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
  activeZoomPreset: ZoomIntensityPreset;
  onZoomPresetChange: (preset: ZoomIntensityPreset) => void;
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  onAddZoom: () => void;
  onResetEdits: () => void;
  onOpenExport: () => void;
};

function formatTimecode(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

function parseTimecode(input: string, fallback: number): number {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  if (trimmed.includes(":")) {
    const [m, s] = trimmed.split(":");
    const val = (Number(m) || 0) * 60 + (Number(s) || 0);
    return Number.isFinite(val) ? val : fallback;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : fallback;
}

export function EditorTimeline({
  project,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  onTrimChange,
  activeZoomPreset,
  onZoomPresetChange,
  selectedZoomId,
  onSelectZoom,
  onAddZoom,
  onResetEdits,
  onOpenExport,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragKind, setDragKind] = useState<"scrub" | "trimStart" | "trimEnd" | null>(null);
  const [startDraft, setStartDraft] = useState<string | null>(null);
  const [endDraft, setEndDraft] = useState<string | null>(null);

  const duration = Math.max(0.5, project.duration);

  const timeFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return frac * duration;
  };

  const applyPointer = (clientX: number, kind: "scrub" | "trimStart" | "trimEnd") => {
    const t = timeFromClientX(clientX);
    if (kind === "scrub") {
      onSeek(Math.max(project.trimStart, Math.min(project.trimEnd, t)));
    } else if (kind === "trimStart") {
      const next = Math.max(0, Math.min(project.trimEnd - 0.3, t));
      onTrimChange(Number(next.toFixed(2)), project.trimEnd);
    } else {
      const next = Math.min(duration, Math.max(project.trimStart + 0.3, t));
      onTrimChange(project.trimStart, Number(next.toFixed(2)));
    }
  };

  const onTrackPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    kind: "scrub" | "trimStart" | "trimEnd",
  ) => {
    e.stopPropagation();
    setDragKind(kind);
    applyPointer(e.clientX, kind);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragKind) return;
    applyPointer(e.clientX, dragKind);
  };

  const onTrackPointerUp = () => setDragKind(null);

  const trimStartPct = (project.trimStart / duration) * 100;
  const trimEndPct = (project.trimEnd / duration) * 100;
  const playheadPct = Math.max(0, Math.min(100, (currentTime / duration) * 100));

  return (
    <section
      className="shrink-0 px-5 py-3.5 select-none"
      style={{
        background: "var(--bg-elev)",
        borderTop: "1px solid var(--border)",
      }}
    >
      {/* Controls Row */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Play/Pause + Timecode + Trim Start/End */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? "Pause playback" : "Play playback"}
            className="flex h-9 w-9 items-center justify-center rounded-xl shadow-sm transition-transform active:scale-95"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            {isPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          </button>

          <div
            className="rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums"
            style={{ background: "var(--inset)", border: "1px solid var(--border)", color: "var(--text)" }}
          >
            <span>{formatTimecode(currentTime)}</span>
            <span className="mx-1.5" style={{ color: "var(--text-3)" }}>
              /
            </span>
            <span style={{ color: "var(--text-2)" }}>{formatTimecode(duration)}</span>
          </div>

          {/* Trim Start / End Inputs */}
          <div
            className="flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <ScissorsIcon className="h-3.5 w-3.5" style={{ color: "var(--text-3)" }} />
            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
              Start
            </span>
            <input
              type="text"
              aria-label="Trim start timestamp"
              value={startDraft ?? formatTimecode(project.trimStart)}
              onChange={(e) => setStartDraft(e.target.value)}
              onBlur={() => {
                if (startDraft !== null) {
                  const v = Math.max(0, Math.min(project.trimEnd - 0.3, parseTimecode(startDraft, project.trimStart)));
                  onTrimChange(Number(v.toFixed(2)), project.trimEnd);
                }
                setStartDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-16 rounded px-1.5 py-0.5 text-center font-mono text-[11px] outline-none"
              style={{ background: "var(--inset)", color: "var(--text)" }}
            />
            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
              End
            </span>
            <input
              type="text"
              aria-label="Trim end timestamp"
              value={endDraft ?? formatTimecode(project.trimEnd)}
              onChange={(e) => setEndDraft(e.target.value)}
              onBlur={() => {
                if (endDraft !== null) {
                  const v = Math.min(duration, Math.max(project.trimStart + 0.3, parseTimecode(endDraft, project.trimEnd)));
                  onTrimChange(project.trimStart, Number(v.toFixed(2)));
                }
                setEndDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-16 rounded px-1.5 py-0.5 text-center font-mono text-[11px] outline-none"
              style={{ background: "var(--inset)", color: "var(--text)" }}
            />
          </div>
        </div>

        {/* Center/Right: Zoom Presets + Add Zoom + Reset + Pinned Export Button */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Zoom intensity presets */}
          <div
            className="inline-flex items-center rounded-xl p-0.5"
            style={{ background: "var(--inset)", border: "1px solid var(--border)" }}
          >
            {(["subtle", "balanced", "close"] as const).map((preset) => {
              const active = activeZoomPreset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onZoomPresetChange(preset)}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-semibold capitalize transition-all"
                  style={
                    active
                      ? { background: "var(--surface-2)", color: "var(--text)", boxShadow: "var(--shadow-sm)" }
                      : { color: "var(--text-3)" }
                  }
                >
                  {preset}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onAddZoom}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              color: "var(--text)",
            }}
          >
            <PlusIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
            <span>Add zoom</span>
          </button>

          <button
            type="button"
            onClick={onResetEdits}
            title="Reset trims, zoom keyframes, and blur regions"
            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-2)",
            }}
          >
            <RotateCcwIcon className="h-3.5 w-3.5" />
            <span>Reset</span>
          </button>

          <div className="h-5 w-px mx-0.5" style={{ background: "var(--border)" }} />

          {/* Primary Export Button pinned bottom-right */}
          <button
            type="button"
            onClick={onOpenExport}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold shadow-md transition-all hover:brightness-105 active:scale-[0.99]"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Visual Waveform + Zoom Segments + Trim Handles Timeline Track */}
      <div
        ref={trackRef}
        onPointerDown={(e) => onTrackPointerDown(e, "scrub")}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
        className="relative h-[74px] w-full cursor-pointer overflow-hidden rounded-xl"
        style={{
          background: "var(--inset)",
          border: "1px solid var(--border)",
        }}
      >
        {/* Waveform Bars */}
        <div className="pointer-events-none absolute inset-x-0 bottom-2 top-7 flex items-center gap-[2px] px-2">
          {project.waveform.map((v, i) => {
            const barPct = (i / Math.max(1, project.waveform.length - 1)) * 100;
            const inTrim = barPct >= trimStartPct && barPct <= trimEndPct;
            const played = barPct <= playheadPct;
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors"
                style={{
                  height: `${Math.max(14, Math.round(v * 100))}%`,
                  background: !inTrim
                    ? "var(--surface-3)"
                    : played
                      ? "var(--wave-active)"
                      : "var(--wave)",
                  opacity: inTrim ? (played ? 0.95 : 0.6) : 0.25,
                }}
              />
            );
          })}
        </div>

        {/* Zoom Keyframe Track Lane (top row inside timeline) */}
        <div className="absolute inset-x-0 top-1.5 h-5 px-1">
          {project.zooms.map((z) => {
            const left = (z.start / duration) * 100;
            const width = Math.max(2.5, (z.duration / duration) * 100);
            const selected = z.id === selectedZoomId;
            return (
              <button
                key={z.id}
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelectZoom(z.id);
                  onSeek(z.start + z.duration * 0.35);
                }}
                className="absolute top-0 flex h-5 items-center gap-1 overflow-hidden rounded-md px-1.5 text-[10px] font-semibold transition-all"
                style={{
                  left: `${left}%`,
                  width: `${Math.min(100 - left, width)}%`,
                  background: selected ? "var(--accent)" : "var(--accent-soft)",
                  border: `1px solid var(--accent)`,
                  color: selected ? "var(--accent-fg)" : "var(--accent)",
                }}
                title={`Zoom ${z.scale.toFixed(1)}× (${z.start.toFixed(1)}s – ${(z.start + z.duration).toFixed(1)}s)`}
              >
                <ZoomInIcon className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate font-mono">{z.scale.toFixed(1)}×</span>
              </button>
            );
          })}
        </div>

        {/* Tracked Click Markers */}
        {project.cursorTrack?.clicks?.map((c, idx) => {
          const left = (c.t / duration) * 100;
          if (left < 0 || left > 100) return null;
          return (
            <span
              key={idx}
              className="pointer-events-none absolute bottom-1 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
              style={{ left: `${left}%`, background: "var(--warning)" }}
            />
          );
        })}

        {/* Trimmed-out left mask */}
        {trimStartPct > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0"
            style={{ width: `${trimStartPct}%`, background: "rgba(0, 0, 0, 0.45)" }}
          />
        )}

        {/* Trimmed-out right mask */}
        {trimEndPct < 100 && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0"
            style={{ width: `${100 - trimEndPct}%`, background: "rgba(0, 0, 0, 0.45)" }}
          />
        )}

        {/* Draggable Trim Start Handle */}
        <div
          role="slider"
          aria-label="Trim start handle"
          aria-valuenow={project.trimStart}
          onPointerDown={(e) => onTrackPointerDown(e, "trimStart")}
          className="absolute inset-y-0 z-20 flex w-2.5 -translate-x-1/2 cursor-ew-resize items-center justify-center"
          style={{ left: `${trimStartPct}%`, background: "var(--accent)" }}
        >
          <span className="h-5 w-0.5 rounded-full" style={{ background: "var(--accent-fg)" }} />
        </div>

        {/* Draggable Trim End Handle */}
        <div
          role="slider"
          aria-label="Trim end handle"
          aria-valuenow={project.trimEnd}
          onPointerDown={(e) => onTrackPointerDown(e, "trimEnd")}
          className="absolute inset-y-0 z-20 flex w-2.5 -translate-x-1/2 cursor-ew-resize items-center justify-center"
          style={{ left: `${trimEndPct}%`, background: "var(--accent)" }}
        >
          <span className="h-5 w-0.5 rounded-full" style={{ background: "var(--accent-fg)" }} />
        </div>

        {/* Playhead Needle */}
        <div
          className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2"
          style={{ left: `${playheadPct}%`, background: "var(--text)" }}
        >
          <div
            className="absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full shadow"
            style={{ background: "var(--text)" }}
          />
        </div>
      </div>
    </section>
  );
}
