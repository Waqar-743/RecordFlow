import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CaptureRegion, DisplayInfo } from "../types";
import { computeRegionToolbarPlacement } from "../utils/regionToolbarLayout";
import { CheckIcon, RecordDotIcon, RotateCcwIcon } from "./Icons";

type SelectionRect = { x: number; y: number; width: number; height: number };
type DragMode = "new" | "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const MIN_SELECTION_SIZE = 64;
const ALIGN = 16;

const HANDLES: { id: DragMode; style: { left: string | number; top: string | number }; cursor: string }[] = [
  { id: "nw", style: { left: 0, top: 0 }, cursor: "nwse-resize" },
  { id: "n", style: { left: "50%", top: 0 }, cursor: "ns-resize" },
  { id: "ne", style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
  { id: "e", style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
  { id: "se", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
  { id: "s", style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
  { id: "sw", style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
  { id: "w", style: { left: 0, top: "50%" }, cursor: "ew-resize" },
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function alignDim(v: number, max: number): number {
  const b = Math.min(Math.max(ALIGN, v), Math.max(ALIGN, max));
  return Math.max(ALIGN, b - (b % ALIGN));
}

type Props = {
  display: DisplayInfo;
  initialRegion?: CaptureRegion | null;
  onConfirm: (region: CaptureRegion, startRecording: boolean) => void;
  onCancel: () => void;
};

/**
 * Full-viewport translucent region selector overlay.
 * Starts clean (no pre-decided selection) so the user can drag to choose their area
 * and immediately record it or apply it to the preview stage.
 */
export function InlineRegionOverlay({ display, onConfirm, onCancel }: Props) {
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [toolbarSize, setToolbarSize] = useState({ width: 520, height: 50 });
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    orig: SelectionRect | null;
  } | null>(null);

  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toRegion = useCallback(
    (rect: SelectionRect): CaptureRegion => {
      const sx = display.width / Math.max(viewport.width, 1);
      const sy = display.height / Math.max(viewport.height, 1);
      const x = Math.max(0, Math.round(rect.x * sx));
      const y = Math.max(0, Math.round(rect.y * sy));
      return {
        x,
        y,
        width: alignDim(Math.round(rect.width * sx), display.width - x),
        height: alignDim(Math.round(rect.height * sy), display.height - y),
      };
    },
    [display.height, display.width, viewport.height, viewport.width],
  );

  const confirm = useCallback(
    (startRecording: boolean) => {
      if (!selection || selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE) {
        setError("Click and drag a capture area at least 64 × 64 pixels.");
        return;
      }
      onConfirm(toRegion(selection), startRecording);
    },
    [onConfirm, selection, toRegion],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && selection) {
        e.preventDefault();
        confirm(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, onCancel, selection]);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setError(null);
    setIsDragging(true);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, orig: selection };
    if (mode === "new") {
      setSelection({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const cx = clamp(e.clientX, 0, viewport.width);
    const cy = clamp(e.clientY, 0, viewport.height);

    if (drag.mode === "new") {
      setSelection({
        x: Math.min(drag.startX, cx),
        y: Math.min(drag.startY, cy),
        width: Math.abs(cx - drag.startX),
        height: Math.abs(cy - drag.startY),
      });
      return;
    }

    const orig = drag.orig;
    if (!orig) return;

    if (drag.mode === "move") {
      setSelection({
        ...orig,
        x: clamp(orig.x + (cx - drag.startX), 0, Math.max(0, viewport.width - orig.width)),
        y: clamp(orig.y + (cy - drag.startY), 0, Math.max(0, viewport.height - orig.height)),
      });
      return;
    }

    let left = orig.x;
    let top = orig.y;
    let right = orig.x + orig.width;
    let bottom = orig.y + orig.height;
    if (drag.mode.includes("w")) left = Math.min(cx, right - MIN_SELECTION_SIZE);
    if (drag.mode.includes("e")) right = Math.max(cx, left + MIN_SELECTION_SIZE);
    if (drag.mode.includes("n")) top = Math.min(cy, bottom - MIN_SELECTION_SIZE);
    if (drag.mode.includes("s")) bottom = Math.max(cy, top + MIN_SELECTION_SIZE);
    setSelection({ x: left, y: top, width: right - left, height: bottom - top });
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);
    if (drag?.mode === "new") {
      setSelection((curr) => {
        if (!curr || curr.width < MIN_SELECTION_SIZE || curr.height < MIN_SELECTION_SIZE) {
          setError("Drag a capture area at least 64 × 64 pixels.");
          return null;
        }
        return curr;
      });
    }
  };

  const preview =
    selection && selection.width >= 16 && selection.height >= 16
      ? toRegion(selection)
      : null;

  const canConfirm =
    selection !== null &&
    selection.width >= MIN_SELECTION_SIZE &&
    selection.height >= MIN_SELECTION_SIZE;

  const showToolbar = !isDragging && canConfirm && preview !== null;

  useLayoutEffect(() => {
    if (!showToolbar || !toolbarRef.current) return;
    const el = toolbarRef.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setToolbarSize((prev) =>
          Math.abs(prev.width - rect.width) > 1 || Math.abs(prev.height - rect.height) > 1
            ? { width: rect.width, height: rect.height }
            : prev,
        );
      }
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [showToolbar, preview?.width, preview?.height]);

  const toolbarPlacement =
    showToolbar && selection
      ? computeRegionToolbarPlacement(
          selection,
          viewport.width,
          viewport.height,
          toolbarSize.width,
          toolbarSize.height,
        )
      : null;

  return (
    <div
      className="rf-region-picker"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => startDrag(e, "new")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Top floating guidance pill — hidden once selection toolbar is active so nothing overlaps Start recording */}
      {!showToolbar && (
        <div
          className={`fixed left-1/2 top-5 z-20 -translate-x-1/2 flex items-center gap-3 rounded-full px-5 py-2.5 text-xs font-medium shadow-2xl transition-opacity ${
            isDragging ? "pointer-events-none opacity-65" : ""
          }`}
          style={{
            background: "rgba(22, 16, 16, 0.95)",
            border: "1px solid rgba(255, 235, 225, 0.18)",
            color: "#f7f1ee",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--accent)" }}
          />
          <span>Click and drag anywhere on screen to select your capture area</span>
          <span className="opacity-40">·</span>
          <span className="font-mono text-[11px] opacity-75">Esc to cancel</span>
          {!isDragging && (
            <button
              type="button"
              onClick={onCancel}
              className="ml-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors"
              style={{ background: "rgba(255,235,225,0.14)", color: "#ffffff" }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Center prompt when no area has been drawn yet */}
      {!selection && !error && (
        <div
          className="pointer-events-none fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 rounded-2xl px-7 py-5 text-center shadow-2xl"
          style={{
            background: "rgba(20, 14, 14, 0.88)",
            border: "1px dashed rgba(255, 107, 74, 0.55)",
            color: "#f7f1ee",
          }}
        >
          <div className="text-sm font-semibold">Click &amp; drag to draw capture area</div>
          <div className="text-xs" style={{ color: "#c9b5b2" }}>
            Release to start recording or adjust its handles
          </div>
        </div>
      )}

      {error && (
        <div
          className="fixed left-1/2 top-20 z-20 -translate-x-1/2 rounded-xl px-4 py-2 text-xs font-medium shadow-xl"
          style={{ background: "rgba(220, 38, 38, 0.94)", color: "#ffffff" }}
        >
          {error}
        </div>
      )}

      {selection && selection.width > 4 && selection.height > 4 && (
        <div
          className="rf-region-picker-selection"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
          onPointerDown={(e) => startDrag(e, "move")}
        >
          <div className="rf-region-picker-grid" />

          {preview && isDragging && (
            <div
              className="pointer-events-none absolute left-2 top-2 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold shadow"
              style={{
                background: "rgba(20, 14, 14, 0.92)",
                color: "var(--accent)",
                border: "1px solid rgba(255, 107, 74, 0.45)",
              }}
            >
              {preview.width} × {preview.height}
            </div>
          )}

          {HANDLES.map((h) => (
            <div
              key={h.id}
              className="rf-region-handle"
              style={{ ...h.style, cursor: h.cursor }}
              onPointerDown={(e) => startDrag(e, h.id)}
            />
          ))}
        </div>
      )}

      {/* Smart viewport-clamped floating toolbar — always stays visible and unobstructed */}
      {showToolbar && preview && toolbarPlacement && (
        <div
          ref={toolbarRef}
          className="rf-region-toolbar"
          style={{
            left: toolbarPlacement.left,
            top: toolbarPlacement.top,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span
            className="inline-flex h-9 items-center rounded-xl px-3 font-mono text-xs font-semibold"
            style={{
              background: "rgba(255, 235, 225, 0.08)",
              border: "1px solid rgba(255, 235, 225, 0.14)",
              color: "var(--accent)",
            }}
          >
            {preview.width} × {preview.height}
          </span>

          <button
            type="button"
            onClick={() => confirm(true)}
            className="rf-btn-primary inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold shadow-lg"
          >
            <RecordDotIcon className="h-3.5 w-3.5" />
            <span>Start recording (Enter)</span>
          </button>

          <button
            type="button"
            onClick={() => confirm(false)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold"
            style={{
              background: "rgba(255, 235, 225, 0.1)",
              border: "1px solid rgba(255, 235, 225, 0.18)",
              color: "#f7f1ee",
            }}
          >
            <CheckIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
            <span>Apply area</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelection(null);
              setError(null);
            }}
            className="inline-flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-medium"
            style={{
              background: "rgba(255, 235, 225, 0.06)",
              border: "1px solid rgba(255, 235, 225, 0.14)",
              color: "#d4c3c0",
            }}
          >
            <RotateCcwIcon className="h-3 w-3" />
            <span>Redraw</span>
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-xl px-3 text-xs font-medium"
            style={{
              background: "rgba(255, 235, 225, 0.06)",
              border: "1px solid rgba(255, 235, 225, 0.14)",
              color: "#f0e6e4",
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
