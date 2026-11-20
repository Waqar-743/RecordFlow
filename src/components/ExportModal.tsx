import { useEffect, useMemo, useRef, useState } from "react";
import { exportProjectLocally, getExportOutputSpecs } from "../editor/exportEngine";
import { isTauriApp, saveExportedVideoFile, tauriService } from "../services/tauri.service";
import type {
  EditorProject,
  ExportFormat,
  ExportFps,
  ExportOptions,
  ExportProgress,
  ExportQuality,
  ExportResolution,
} from "../types";
import { CheckIcon, DownloadIcon, FolderOpenIcon, ShieldCheckIcon, XIcon } from "./Icons";

type Props = {
  isOpen: boolean;
  project: EditorProject | null;
  onClose: () => void;
  onExportComplete?: (savedPath: string) => void;
};

const FORMAT_OPTIONS: { id: ExportFormat; title: string; subtitle: string }[] = [
  { id: "mp4", title: "MP4", subtitle: "Plays everywhere — recommended" },
  { id: "webm", title: "WebM", subtitle: "For the web" },
];

const RESOLUTION_OPTIONS: { id: ExportResolution; title: string; subtitle: string }[] = [
  { id: "4k", title: "4K", subtitle: "2160p" },
  { id: "1440p", title: "1440p", subtitle: "QHD" },
  { id: "1080p", title: "1080p", subtitle: "Full HD" },
  { id: "720p", title: "720p", subtitle: "Smaller file" },
];

const FPS_OPTIONS: { id: ExportFps; title: string; subtitle: string }[] = [
  { id: 60, title: "60 fps", subtitle: "Smoothest" },
  { id: 30, title: "30 fps", subtitle: "Smaller" },
];

const QUALITY_OPTIONS: { id: ExportQuality; title: string; subtitle: string }[] = [
  { id: "best", title: "Best", subtitle: "Max clarity" },
  { id: "high", title: "High", subtitle: "Balanced" },
  { id: "small", title: "Small", subtitle: "Compact" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportModal({ isOpen, project, onClose, onExportComplete }: Props) {
  const [options, setOptions] = useState<ExportOptions>({
    format: "mp4",
    resolution: "1080p",
    fps: 60,
    quality: "high",
  });

  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [renderedBlob, setRenderedBlob] = useState<Blob | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setProgress(null);
    setRenderedBlob(null);
    setSavedPath(null);
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (!progress || progress.phase === "done" || progress.phase === "error")) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, progress]);

  const specs = useMemo(
    () => (project ? getExportOutputSpecs(project, options) : null),
    [options, project],
  );

  if (!isOpen || !project || !specs) return null;

  const isRendering =
    progress !== null &&
    (progress.phase === "preparing" ||
      progress.phase === "rendering" ||
      progress.phase === "finalizing");

  const suggestedFileName = `${project.name.replace(/[^a-z0-9-_]+/gi, "_")}_${options.resolution}_${options.fps}fps.${options.format}`;

  const handleStartExport = async () => {
    setError(null);
    setSavedPath(null);
    setRenderedBlob(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const blob = await exportProjectLocally(project, options, setProgress, controller.signal);
      setRenderedBlob(blob);
      setProgress({
        phase: "done",
        progress: 1,
        currentFrame: Math.ceil(specs.trimmedDuration * options.fps),
        totalFrames: Math.ceil(specs.trimmedDuration * options.fps),
        etaSeconds: 0,
        message: `Render complete (${formatBytes(blob.size)})`,
      });

      const res = await saveExportedVideoFile(blob, suggestedFileName, options.format);
      if (res.saved && res.filePath) {
        setSavedPath(res.filePath);
        onExportComplete?.(res.filePath);
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setProgress(null);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      abortRef.current = null;
    }
  };

  const handleSaveAgain = async () => {
    if (!renderedBlob) return;
    const res = await saveExportedVideoFile(renderedBlob, suggestedFileName, options.format);
    if (res.saved && res.filePath) {
      setSavedPath(res.filePath);
      onExportComplete?.(res.filePath);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm select-none"
      style={{ background: "var(--scrim)" }}
      onClick={() => {
        if (!isRendering) onClose();
      }}
    >
      <div
        className="rf-pop-in w-full max-w-xl overflow-hidden rounded-2xl"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-lg)",
          color: "var(--text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h2 className="text-base font-semibold">Export video</h2>
            <p
              className="mt-1 inline-flex items-center gap-1.5 text-xs"
              style={{ color: "var(--text-2)" }}
            >
              <ShieldCheckIcon className="h-3.5 w-3.5" style={{ color: "var(--success)" }} />
              <span>Rendered on this computer. Nothing is uploaded.</span>
            </p>
          </div>
          {!isRendering && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close export modal"
              className="rounded-lg p-1.5"
              style={{ color: "var(--text-2)" }}
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="space-y-5 p-6">
          {/* Format */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
              Format
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {FORMAT_OPTIONS.map((opt) => {
                const active = options.format === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isRendering}
                    onClick={() => setOptions((o) => ({ ...o, format: opt.id }))}
                    className="rounded-xl px-3.5 py-3 text-left transition-all disabled:opacity-50"
                    style={{
                      background: active ? "var(--accent-soft)" : "var(--surface-2)",
                      border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    }}
                  >
                    <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                      {opt.title}
                    </div>
                    <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-2)" }}>
                      {opt.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Resolution */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
              Resolution
            </div>
            <div className="grid grid-cols-4 gap-2">
              {RESOLUTION_OPTIONS.map((opt) => {
                const active = options.resolution === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isRendering}
                    onClick={() => setOptions((o) => ({ ...o, resolution: opt.id }))}
                    className="rounded-xl px-3 py-2.5 text-left transition-all disabled:opacity-50"
                    style={{
                      background: active ? "var(--accent-soft)" : "var(--surface-2)",
                      border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    }}
                  >
                    <div className="font-mono text-xs font-semibold" style={{ color: "var(--text)" }}>
                      {opt.title}
                    </div>
                    <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-3)" }}>
                      {opt.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Frame Rate + Quality Row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                Frame rate
              </div>
              <div className="grid grid-cols-2 gap-2">
                {FPS_OPTIONS.map((opt) => {
                  const active = options.fps === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isRendering}
                      onClick={() => setOptions((o) => ({ ...o, fps: opt.id }))}
                      className="rounded-xl px-3 py-2.5 text-left transition-all disabled:opacity-50"
                      style={{
                        background: active ? "var(--accent-soft)" : "var(--surface-2)",
                        border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      <div className="font-mono text-xs font-semibold" style={{ color: "var(--text)" }}>
                        {opt.title}
                      </div>
                      <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-3)" }}>
                        {opt.subtitle}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                Quality
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {QUALITY_OPTIONS.map((opt) => {
                  const active = options.quality === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isRendering}
                      onClick={() => setOptions((o) => ({ ...o, quality: opt.id }))}
                      className="rounded-xl px-2.5 py-2.5 text-left transition-all disabled:opacity-50"
                      style={{
                        background: active ? "var(--accent-soft)" : "var(--surface-2)",
                        border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                        {opt.title}
                      </div>
                      <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-3)" }}>
                        {opt.subtitle}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Output Summary Bar */}
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-xs"
            style={{ background: "var(--inset)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3 font-mono text-[11px]" style={{ color: "var(--text-2)" }}>
              <span>
                {specs.width} × {specs.height}
              </span>
              <span>·</span>
              <span>{specs.trimmedDuration.toFixed(1)}s</span>
              <span>·</span>
              <span>{options.fps} fps</span>
            </div>
            <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
              Est. ~{formatBytes(specs.estimatedBytes)}
            </span>
          </div>

          {/* Real-time Progress Bar */}
          {progress && (
            <div
              className="space-y-2 rounded-xl p-3.5"
              style={{
                background: progress.phase === "done" ? "var(--success-soft)" : "var(--surface-2)",
                border: `1px solid ${progress.phase === "done" ? "var(--success)" : "var(--border-strong)"}`,
              }}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: "var(--text)" }}>
                  {progress.message}
                </span>
                <span className="font-mono text-[11px] font-semibold" style={{ color: "var(--accent)" }}>
                  {Math.round(progress.progress * 100)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--inset)" }}>
                <div
                  className="h-full rounded-full transition-[width] duration-150"
                  style={{
                    width: `${Math.round(progress.progress * 100)}%`,
                    background: progress.phase === "done" ? "var(--success)" : "var(--accent)",
                  }}
                />
              </div>
              {progress.etaSeconds !== null && isRendering && (
                <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  Estimated time remaining: ~{Math.max(1, Math.round(progress.etaSeconds))}s
                </div>
              )}
              {savedPath && (
                <div className="flex items-center justify-between pt-1 text-[11px]" style={{ color: "var(--text-2)" }}>
                  <span className="truncate">Saved: {savedPath}</span>
                  {isTauriApp() && (
                    <button
                      type="button"
                      onClick={() => void tauriService.openRecordingInExplorer(savedPath)}
                      className="ml-2 inline-flex shrink-0 items-center gap-1 font-semibold underline"
                      style={{ color: "var(--accent)" }}
                    >
                      <FolderOpenIcon className="h-3 w-3" />
                      Show in folder
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              className="rounded-xl p-3 text-xs"
              style={{
                background: "var(--danger-soft)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className="flex items-center justify-end gap-2.5 px-6 py-4"
          style={{ background: "var(--bg-elev)", borderTop: "1px solid var(--border)" }}
        >
          {isRendering ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-xl px-4 py-2 text-xs font-semibold"
              style={{
                background: "var(--danger-soft)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
              }}
            >
              Cancel render
            </button>
          ) : progress?.phase === "done" && renderedBlob ? (
            <>
              <button
                type="button"
                onClick={() => void handleSaveAgain()}
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-strong)",
                  color: "var(--text)",
                }}
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                <span>Save copy</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-semibold"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                <CheckIcon className="h-3.5 w-3.5" />
                <span>Done</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-xs font-medium"
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
                onClick={() => void handleStartExport()}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-semibold shadow-md transition-all hover:brightness-105"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                <span>Export {options.format.toUpperCase()}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
