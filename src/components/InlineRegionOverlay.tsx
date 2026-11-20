import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CaptureRegion, DisplayInfo } from "../types";

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
  initialRegion: CaptureRegion | null;
  onConfirm: (region: CaptureRegion) => void;
  onCancel: () => void;
};

/**
 * Full-viewport translucent region selector overlay used in browser preview mode.
 * Mirrors the native Tauri RegionPickerWindow interaction identically.
 */
export function InlineRegionOverlay({ display, initialRegion, onConfirm, onCancel }: Props) {
  const [selection, setSelection] = useState<SelectionRect | null>(() => {
    if (!initialRegion) return null;
    const sx = window.innerWidth / Math.max(display.width, 1);
    const sy = window.innerHeight / Math.max(display.height, 1);
    const w = initialRegion.width * sx;
    const h = initialRegion.height * sy;
    if (w < MIN_SELECTION_SIZE || h < MIN_SELECTION_SIZE) return null;
    return { x: initialRegion.x * sx, y: initialRegion.y * sy, width: w, height: h };
  });
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    orig: SelectionRect | null;
  } | null>(null);

  const toRegion = useCallback(
    (rect: SelectionRect): CaptureRegion => {
      const sx = display.width / Math.max(window.innerWidth, 1);
      const sy = display.height / Math.max(window.innerHeight, 1);
      const x = Math.max(0, Math.round(rect.x * sx));
      const y = Math.max(0, Math.round(rect.y * sy));
      return {
        x,
        y,
        width: alignDim(Math.round(rect.width * sx), display.width - x),
        height: alignDim(Math.round(rect.height * sy), display.height - y),
      };
    },
    [display.height, display.width],
  );

  const confirm = useCallback(() => {
    if (!selection || selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE) {
      setError("Drag a capture area at least 64 × 64 pixels.");
      return;
    }
    onConfirm(toRegion(selection));
  }, [onConfirm, selection, toRegion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && selection) {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, onCancel, selection]);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setError(null);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, orig: selection };
    if (mode === "new") {
      setSelection({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const cx = clamp(e.clientX, 0, window.innerWidth);
    const cy = clamp(e.clientY, 0, window.innerHeight);

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
        x: clamp(orig.x + (cx - drag.startX), 0, Math.max(0, window.innerWidth - orig.width)),
        y: clamp(orig.y + (cy - drag.startY), 0, Math.max(0, window.innerHeight - orig.height)),
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
    selection && selection.width >= MIN_SELECTION_SIZE && selection.height >= MIN_SELECTION_SIZE
      ? toRegion(selection)
      : null;

  const toolbarBelow = selection ? selection.y + selection.height < window.innerHeight - 68 : true;

  return (
    <div
      className="rf-region-picker"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => startDrag(e, "new")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Top floating guidance pill */}
      <div
        className="fixed left-1/2 top-6 z-10 -translate-x-1/2 flex items-center gap-3 rounded-full px-4 py-2 text-xs font-medium shadow-2xl"
        style={{
          background: "rgba(15, 17, 22, 0.92)",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          color: "#f4f4f5",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span>Click and drag to select capture region</span>
        <span className="opacity-40">·</span>
        <span className="font-mono text-[11px] opacity-75">Esc to cancel</span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
          style={{ background: "rgba(255,255,255,0.12)", color: "#ffffff" }}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div
          className="fixed left-1/2 top-20 z-10 -translate-x-1/2 rounded-xl px-4 py-2 text-xs font-medium shadow-xl"
          style={{ background: "rgba(220, 38, 38, 0.92)", color: "#ffffff" }}
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
          {HANDLES.map((h) => (
            <div
              key={h.id}
              className="rf-region-handle"
              style={{ ...h.style, cursor: h.cursor }}
              onPointerDown={(e) => startDrag(e, h.id)}
            />
          ))}

          {preview && (
            <div
              className="rf-region-toolbar"
              style={toolbarBelow ? { top: "calc(100% + 12px)" } : { bottom: "calc(100% + 12px)" }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span
                className="inline-flex h-8 items-center rounded-lg px-2.5 font-mono text-xs font-semibold shadow-lg"
                style={{
                  background: "rgba(12, 13, 18, 0.94)",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                  color: "var(--accent)",
                }}
              >
                {preview.width} × {preview.height}
              </span>
              <button
                type="button"
                onClick={confirm}
                className="h-8 rounded-lg px-3.5 text-xs font-semibold shadow-lg transition-opacity hover:opacity-90"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                Lock area (Enter)
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="h-8 rounded-lg px-3 text-xs font-medium shadow-lg"
                style={{
                  background: "rgba(12, 13, 18, 0.92)",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                  color: "#e4e4e7",
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
