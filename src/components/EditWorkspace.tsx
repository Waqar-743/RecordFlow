import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  getAspectDimensions,
  renderCompositionFrame,
  ZOOM_PRESET_SCALES,
  type CanvasGeometry,
} from "../editor/canvasRenderer";
import type { EditorProject, InspectorTab, ZoomIntensityPreset } from "../types";
import { EditorInspector } from "./EditorInspector";
import { EditorTimeline } from "./EditorTimeline";
import { FilmIcon, FolderOpenIcon, RecordDotIcon, SparklesIcon } from "./Icons";

type Props = {
  project: EditorProject | null;
  onProjectChange: (updater: (prev: EditorProject) => EditorProject) => void;
  onGoToRecord: () => void;
  onOpenProject: () => void;
  onLoadDemo: () => Promise<void>;
  onOpenExport: () => void;
};

type DragTarget =
  | { kind: "camera"; offsetX: number; offsetY: number }
  | { kind: "blur"; id: string; offsetX: number; offsetY: number };

export function EditWorkspace({
  project,
  onProjectChange,
  onGoToRecord,
  onOpenProject,
  onLoadDemo,
  onOpenExport,
}: Props) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("canvas");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeZoomPreset, setActiveZoomPreset] = useState<ZoomIntensityPreset>("balanced");
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [selectedBlurId, setSelectedBlurId] = useState<string | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [dragHoverHint, setDragHoverHint] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const customBgImgRef = useRef<HTMLImageElement | null>(null);
  const geomRef = useRef<CanvasGeometry | null>(null);
  const dragRef = useRef<DragTarget | null>(null);

  // Keep latest project in a ref for smooth 60fps requestAnimationFrame rendering
  const projectRef = useRef<EditorProject | null>(project);
  projectRef.current = project;

  // Reset playhead when loading a new project
  useEffect(() => {
    if (!project) return;
    setIsPlaying(false);
    setCurrentTime(project.trimStart);
    setSelectedZoomId(project.zooms[0]?.id ?? null);
    setSelectedBlurId(null);
  }, [project?.id]);

  // Load custom background image into an HTMLImageElement whenever URL changes
  useEffect(() => {
    const url = project?.canvas.customBackgroundUrl;
    if (!url) {
      customBgImgRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    customBgImgRef.current = img;
  }, [project?.canvas.customBackgroundUrl]);

  // Apply live audio volume & mute balance to the screen video playback element
  useEffect(() => {
    const v = screenVideoRef.current;
    if (!v || !project) return;
    const effective =
      project.audio.masterVolume *
      Math.max(
        project.audio.micMuted ? 0 : project.audio.micVolume,
        project.audio.systemMuted ? 0 : project.audio.systemVolume,
      );
    v.muted = effective <= 0.001;
    v.volume = Math.max(0, Math.min(1, effective));
  }, [project?.audio]);

  // Sync camera video element to screen video time
  const seekBoth = useCallback((t: number) => {
    const p = projectRef.current;
    if (!p) return;
    const clamped = Math.max(0, Math.min(p.duration, t));
    setCurrentTime(clamped);
    if (screenVideoRef.current) {
      screenVideoRef.current.currentTime = clamped;
    }
    if (cameraVideoRef.current && p.cameraUrl) {
      cameraVideoRef.current.currentTime = clamped;
    }
  }, []);

  const togglePlay = useCallback(() => {
    const v = screenVideoRef.current;
    const p = projectRef.current;
    if (!v || !p) return;

    if (isPlaying) {
      v.pause();
      cameraVideoRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (v.currentTime < p.trimStart || v.currentTime >= p.trimEnd - 0.05) {
        seekBoth(p.trimStart);
      }
      void v.play().catch(() => {});
      if (cameraVideoRef.current && p.cameraUrl) {
        cameraVideoRef.current.currentTime = v.currentTime;
        void cameraVideoRef.current.play().catch(() => {});
      }
      setIsPlaying(true);
    }
  }, [isPlaying, seekBoth]);

  // Spacebar toggles playback inside Edit Studio (when not typing in an input)
  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, togglePlay]);

  // Continuous 60fps composition preview loop
  useEffect(() => {
    if (!project) return;
    let rafId = 0;

    const renderTick = () => {
      const p = projectRef.current;
      const canvas = canvasRef.current;
      const sv = screenVideoRef.current;
      const cv = cameraVideoRef.current;

      if (p && canvas) {
        const dims = getAspectDimensions(p.canvas.aspectRatio, p.sourceWidth, p.sourceHeight, 1280);
        if (canvas.width !== dims.width || canvas.height !== dims.height) {
          canvas.width = dims.width;
          canvas.height = dims.height;
        }

        const t = sv ? sv.currentTime : currentTime;
        if (sv && !sv.paused) {
          if (t >= p.trimEnd) {
            sv.pause();
            cv?.pause();
            sv.currentTime = p.trimStart;
            if (cv && p.cameraUrl) cv.currentTime = p.trimStart;
            setCurrentTime(p.trimStart);
            setIsPlaying(false);
          } else {
            setCurrentTime(t);
            // Keep camera drift within 80ms
            if (cv && p.cameraUrl && Math.abs(cv.currentTime - t) > 0.08) {
              cv.currentTime = t;
            }
          }
        }

        const ctx = canvas.getContext("2d");
        if (ctx) {
          geomRef.current = renderCompositionFrame(
            ctx,
            p,
            sv ? sv.currentTime : currentTime,
            {
              screenVideo: sv && sv.readyState >= 2 ? sv : null,
              cameraVideo: cv && p.cameraUrl && cv.readyState >= 2 ? cv : null,
              customBgImage: customBgImgRef.current,
            },
            {
              selectedBlurId: activeTab === "blur" ? selectedBlurId : null,
              selectedZoomId: activeTab === "zoom" ? selectedZoomId : null,
              showGuides: true,
            },
          );
        }
      }

      rafId = window.requestAnimationFrame(renderTick);
    };

    rafId = window.requestAnimationFrame(renderTick);
    return () => window.cancelAnimationFrame(rafId);
  }, [activeTab, currentTime, project?.id, selectedBlurId, selectedZoomId]);

  // Convert pointer event into canvas pixel coordinates
  const getCanvasPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  // Direct Canvas Drag-and-Drop for Camera Overlay, Blur Regions, and Zoom Focus Clicks
  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!project) return;
    const pt = getCanvasPoint(e);
    const geom = geomRef.current;
    if (!pt || !geom) return;

    // 1. Check hit on independent Camera Overlay first (draggable from any tab!)
    if (geom.cameraRect && project.camera.enabled && project.cameraUrl) {
      const cr = geom.cameraRect;
      if (pt.x >= cr.x && pt.x <= cr.x + cr.w && pt.y >= cr.y && pt.y <= cr.y + cr.h) {
        dragRef.current = {
          kind: "camera",
          offsetX: pt.x - (cr.x + cr.w / 2),
          offsetY: pt.y - (cr.y + cr.h / 2),
        };
        setActiveTab("camera");
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
    }

    // 2. Check hit on any active Blur region
    for (let i = project.blurs.length - 1; i >= 0; i--) {
      const b = project.blurs[i];
      const bx = geom.frameX + b.x * geom.frameW;
      const by = geom.frameY + b.y * geom.frameH;
      const bw = b.width * geom.frameW;
      const bh = b.height * geom.frameH;
      if (pt.x >= bx && pt.x <= bx + bw && pt.y >= by && pt.y <= by + bh) {
        setSelectedBlurId(b.id);
        setActiveTab("blur");
        dragRef.current = { kind: "blur", id: b.id, offsetX: pt.x - bx, offsetY: pt.y - by };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
    }

    // 3. If in Zoom tab with a selected keyframe, clicking inside frame moves zoom focus point
    if (activeTab === "zoom" && selectedZoomId) {
      const fx = Math.max(0.1, Math.min(0.9, (pt.x - geom.frameX) / Math.max(1, geom.frameW)));
      const fy = Math.max(0.1, Math.min(0.9, (pt.y - geom.frameY) / Math.max(1, geom.frameH)));
      onProjectChange((p) => ({
        ...p,
        zooms: p.zooms.map((z) =>
          z.id === selectedZoomId ? { ...z, focusX: fx, focusY: fy } : z,
        ),
      }));
    }
  };

  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pt = getCanvasPoint(e);
    const geom = geomRef.current;
    if (!pt || !geom || !project) return;

    const drag = dragRef.current;
    if (!drag) {
      // Hover hint for interactive elements
      if (geom.cameraRect && project.camera.enabled && project.cameraUrl) {
        const cr = geom.cameraRect;
        if (pt.x >= cr.x && pt.x <= cr.x + cr.w && pt.y >= cr.y && pt.y <= cr.y + cr.h) {
          setDragHoverHint("Drag to reposition camera overlay");
          return;
        }
      }
      setDragHoverHint(null);
      return;
    }

    if (drag.kind === "camera") {
      const nx = Math.max(0.06, Math.min(0.94, (pt.x - drag.offsetX) / geom.canvasW));
      const ny = Math.max(0.06, Math.min(0.94, (pt.y - drag.offsetY) / geom.canvasH));
      onProjectChange((p) => ({
        ...p,
        camera: { ...p.camera, x: nx, y: ny },
      }));
      return;
    }

    if (drag.kind === "blur") {
      const nx = Math.max(0, Math.min(0.95, (pt.x - drag.offsetX - geom.frameX) / Math.max(1, geom.frameW)));
      const ny = Math.max(0, Math.min(0.95, (pt.y - drag.offsetY - geom.frameY) / Math.max(1, geom.frameH)));
      onProjectChange((p) => ({
        ...p,
        blurs: p.blurs.map((b) => (b.id === drag.id ? { ...b, x: nx, y: ny } : b)),
      }));
    }
  };

  const onCanvasPointerUp = () => {
    dragRef.current = null;
  };

  const addZoomAtPlayhead = useCallback(
    (intensity: ZoomIntensityPreset) => {
      if (!project) return;
      const start = Math.max(project.trimStart, Math.min(project.trimEnd - 0.8, currentTime));
      const id = `zk-${Math.random().toString(36).slice(2, 8)}`;
      const next = {
        id,
        start: Number(start.toFixed(2)),
        duration: Math.min(2.2, Math.max(0.6, Number((project.trimEnd - start).toFixed(2)))),
        scale: ZOOM_PRESET_SCALES[intensity],
        focusX: 0.5,
        focusY: 0.5,
        intensity,
      };
      onProjectChange((p) => ({
        ...p,
        zooms: [...p.zooms, next].sort((a, b) => a.start - b.start),
      }));
      setSelectedZoomId(id);
      setActiveTab("zoom");
    },
    [currentTime, onProjectChange, project],
  );

  const addBlurRegion = useCallback(() => {
    if (!project) return;
    const id = `blur-${Math.random().toString(36).slice(2, 8)}`;
    const next = {
      id,
      label: `Blur region ${project.blurs.length + 1}`,
      x: 0.35,
      y: 0.35,
      width: 0.24,
      height: 0.14,
      intensity: 16,
      startTime: project.trimStart,
      endTime: project.trimEnd,
      alwaysVisible: true,
    };
    onProjectChange((p) => ({ ...p, blurs: [...p.blurs, next] }));
    setSelectedBlurId(id);
    setActiveTab("blur");
  }, [onProjectChange, project]);

  // Empty state if user visits Edit before recording anything
  if (!project) {
    return (
      <div className="rf-stage-bg flex flex-1 items-center justify-center p-8">
        <div
          className="rf-card flex max-w-md flex-col items-center gap-4 rounded-3xl p-8 text-center"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            <FilmIcon className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
              Post-Recording Studio
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
              Record your screen to jump straight into editing with backgrounds, auto-zoom, draggable webcam overlays, and local 4K export — or open an existing clip.
            </p>
          </div>

          <div className="mt-2 flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={onGoToRecord}
              className="rf-btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold"
            >
              <RecordDotIcon className="h-3.5 w-3.5" />
              <span>Start a new recording</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onOpenProject}
                className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                <FolderOpenIcon className="h-3.5 w-3.5" />
                <span>Open video</span>
              </button>

              <button
                type="button"
                disabled={loadingDemo}
                onClick={() => {
                  setLoadingDemo(true);
                  void onLoadDemo().finally(() => setLoadingDemo(false));
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium disabled:opacity-50"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                <SparklesIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                <span>{loadingDemo ? "Loading…" : "Try demo clip"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Hidden Synchronized Video Decoders */}
      <video
        ref={screenVideoRef}
        src={project.screenUrl}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        className="hidden"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (Number.isFinite(v.duration) && v.duration > 0.2 && Math.abs(v.duration - project.duration) > 0.4) {
            onProjectChange((p) => ({
              ...p,
              duration: v.duration,
              trimEnd: Math.min(v.duration, p.trimEnd === p.duration ? v.duration : p.trimEnd),
              sourceWidth: v.videoWidth || p.sourceWidth,
              sourceHeight: v.videoHeight || p.sourceHeight,
            }));
          }
        }}
      />
      {project.cameraUrl && (
        <video
          ref={cameraVideoRef}
          src={project.cameraUrl}
          muted
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          className="hidden"
        />
      )}

      {/* Left Column: Stage + Interactive Timeline */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Presentation Canvas Stage */}
        <div className="rf-stage-bg relative flex flex-1 items-center justify-center overflow-hidden p-6">
          {/* Top-left Project Pill with Inline Editable Title */}
          <div
            className="absolute left-4 top-3.5 z-10 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-2)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <input
              type="text"
              aria-label="Project title"
              value={project.name}
              onChange={(e) =>
                onProjectChange((p) => ({ ...p, name: e.target.value }))
              }
              className="w-36 truncate bg-transparent font-semibold outline-none"
              style={{ color: "var(--text)" }}
              title="Click to rename project"
            />
            <span style={{ color: "var(--text-3)" }}>·</span>
            <span className="font-mono">{project.canvas.aspectRatio}</span>
            {project.cameraUrl && project.camera.enabled && (
              <>
                <span style={{ color: "var(--text-3)" }}>·</span>
                <span style={{ color: "var(--accent)" }}>Cam layer</span>
              </>
            )}
          </div>

          {/* Drag Hint Badge */}
          {dragHoverHint && (
            <div
              className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-medium shadow"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--accent)",
                color: "var(--text)",
              }}
            >
              {dragHoverHint}
            </div>
          )}

          {/* Live Composition Canvas */}
          <canvas
            ref={canvasRef}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            className="max-h-full max-w-full rounded-xl shadow-2xl"
            style={{
              cursor: dragHoverHint ? "grab" : activeTab === "zoom" && selectedZoomId ? "crosshair" : "default",
              border: "1px solid var(--border-strong)",
            }}
          />
        </div>

        {/* Bottom Interactive Timeline & Playback Bar */}
        <EditorTimeline
          project={project}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          onSeek={seekBoth}
          onTrimChange={(trimStart, trimEnd) => {
            onProjectChange((p) => ({ ...p, trimStart, trimEnd }));
            if (currentTime < trimStart) seekBoth(trimStart);
            if (currentTime > trimEnd) seekBoth(trimEnd);
          }}
          activeZoomPreset={activeZoomPreset}
          onZoomPresetChange={(preset) => {
            setActiveZoomPreset(preset);
            if (selectedZoomId) {
              onProjectChange((p) => ({
                ...p,
                zooms: p.zooms.map((z) =>
                  z.id === selectedZoomId
                    ? { ...z, intensity: preset, scale: ZOOM_PRESET_SCALES[preset] }
                    : z,
                ),
              }));
            }
          }}
          selectedZoomId={selectedZoomId}
          onSelectZoom={(id) => {
            setSelectedZoomId(id);
            if (id) setActiveTab("zoom");
          }}
          onAddZoom={() => addZoomAtPlayhead(activeZoomPreset)}
          onResetEdits={() => {
            onProjectChange((p) => ({
              ...p,
              trimStart: 0,
              trimEnd: p.duration,
              zooms: [],
              blurs: [],
            }));
            setSelectedZoomId(null);
            setSelectedBlurId(null);
            seekBoth(0);
          }}
          onOpenExport={() => {
            if (isPlaying) togglePlay();
            onOpenExport();
          }}
        />
      </div>

      {/* Right Inspector Sidebar */}
      <EditorInspector
        project={project}
        onChange={onProjectChange}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currentTime={currentTime}
        selectedZoomId={selectedZoomId}
        onSelectZoom={setSelectedZoomId}
        selectedBlurId={selectedBlurId}
        onSelectBlur={setSelectedBlurId}
        onAddZoomAtPlayhead={addZoomAtPlayhead}
        onAddBlurRegion={addBlurRegion}
        onAttachCameraFile={(url) =>
          onProjectChange((p) => ({
            ...p,
            cameraUrl: url,
            camera: { ...p.camera, enabled: true },
          }))
        }
      />
    </div>
  );
}
