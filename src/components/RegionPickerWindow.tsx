import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CaptureRegion } from "../types";

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragMode = "new" | "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const MIN_SELECTION_SIZE = 64;
const H264_DIMENSION_ALIGNMENT = 16;

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

function alignedWithinBounds(value: number, maxValue: number): number {
  const bounded = Math.min(
    Math.max(H264_DIMENSION_ALIGNMENT, value),
    Math.max(H264_DIMENSION_ALIGNMENT, maxValue),
  );
  return Math.max(
    H264_DIMENSION_ALIGNMENT,
    bounded - (bounded % H264_DIMENSION_ALIGNMENT),
  );
}

function readParams() {
  const params = new URLSearchParams(window.location.search);
  const displayWidth = Number(params.get("displayWidth")) || window.innerWidth;
  const displayHeight = Number(params.get("displayHeight")) || window.innerHeight;
  const initX = params.get("initX");
  const initY = params.get("initY");
  const initW = params.get("initW");
  const initH = params.get("initH");

  let initial: SelectionRect | null = null;
  if (initX !== null && initY !== null && initW !== null && initH !== null) {
    const scaleX = window.innerWidth / Math.max(displayWidth, 1);
    const scaleY = window.innerHeight / Math.max(displayHeight, 1);
    const w = Number(initW) * scaleX;
    const h = Number(initH) * scaleY;
    if (w >= MIN_SELECTION_SIZE && h >= MIN_SELECTION_SIZE) {
      initial = {
        x: Number(initX) * scaleX,
        y: Number(initY) * scaleY,
        width: w,
        height: h,
      };
    }
  }

  return { displayWidth, displayHeight, initial };
}

export function RegionPickerWindow() {
  const { displayWidth, displayHeight, initial } = useMemo(readParams, []);
  const [selection, setSelection] = useState<SelectionRect | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    orig: SelectionRect | null;
  } | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("rf-picker-mode");
    return () => {
      document.documentElement.classList.remove("rf-picker-mode");
    };
  }, []);

  const toAlignedRegion = useCallback(
    (rect: SelectionRect): CaptureRegion => {
      const scaleX = displayWidth / Math.max(window.innerWidth, 1);
      const scaleY = displayHeight / Math.max(window.innerHeight, 1);
      const x = Math.max(0, Math.round(rect.x * scaleX));
      const y = Math.max(0, Math.round(rect.y * scaleY));
      return {
        x,
        y,
        width: alignedWithinBounds(Math.round(rect.width * scaleX), displayWidth - x),
        height: alignedWithinBounds(Math.round(rect.height * scaleY), displayHeight - y),
      };
    },
    [displayHeight, displayWidth],
  );

  const cancel = useCallback(async () => {
    await emit("region-picker:cancelled");
    await getCurrentWebviewWindow().close();
  }, []);

  const confirm = useCallback(async () => {
    if (!selection || selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE) {
      setError("Selection is too small (minimum 64 × 64).");
      return;
    }
    const region = toAlignedRegion(selection);
    await emit("region-picker:selected", { region });
    await getCurrentWebviewWindow().close();
  }, [selection, toAlignedRegion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void cancel();
      } else if (event.key === "Enter" && selection) {
        event.preventDefault();
        void confirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, confirm, selection]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, mode: DragMode) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.stopPropagation();
    setError(null);
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      orig: selection,
    };
    if (mode === "new") {
      setSelection({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    const cx = clamp(event.clientX, 0, window.innerWidth);
    const cy = clamp(event.clientY, 0, window.innerHeight);

    if (drag.mode === "new") {
      const x = Math.min(drag.startX, cx);
      const y = Math.min(drag.startY, cy);
      setSelection({
        x,
        y,
        width: Math.abs(cx - drag.startX),
        height: Math.abs(cy - drag.startY),
      });
      return;
    }

    const orig = drag.orig;
    if (!orig) return;

    if (drag.mode === "move") {
      const dx = cx - drag.startX;
      const dy = cy - drag.startY;
      setSelection({
        ...orig,
        x: clamp(orig.x + dx, 0, Math.max(0, window.innerWidth - orig.width)),
        y: clamp(orig.y + dy, 0, Math.max(0, window.innerHeight - orig.height)),
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

    setSelection({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.mode === "new") {
      setSelection((curr) => {
        if (!curr || curr.width < MIN_SELECTION_SIZE || curr.height < MIN_SELECTION_SIZE) {
          setError("Drag a larger area (at least 64 × 64 pixels).");
          return null;
        }
        return curr;
      });
    }
  };

  const alignedPreview = selection && selection.width >= MIN_SELECTION_SIZE && selection.height >= MIN_SELECTION_SIZE
    ? toAlignedRegion(selection)
    : null;

  const toolbarBelow = selection ? selection.y + selection.height < window.innerHeight - 64 : true;

  return (
    <div
      className="rf-region-picker rf-region-picker-window"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(e) => startDrag(e, "new")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {!selection && (
        <div className="rf-region-picker-hint">
          Drag to select the recording area · Press Esc to cancel
        </div>
      )}

      <button
        className="rf-region-picker-cancel"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => void cancel()}
        type="button"
      >
        Cancel (Esc)
      </button>

      {error && <div className="rf-region-picker-error">{error}</div>}

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

          {alignedPreview && (
            <div
              className="rf-region-toolbar"
              style={toolbarBelow ? { top: "calc(100% + 10px)" } : { bottom: "calc(100% + 10px)" }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="inline-flex h-8 items-center rounded-lg border border-white/15 bg-zinc-950/90 px-2.5 font-mono text-xs font-medium text-sky-300 shadow-lg">
                {alignedPreview.width} × {alignedPreview.height}
              </span>
              <button
                type="button"
                onClick={() => void confirm()}
                className="h-8 rounded-lg bg-sky-400 px-3.5 text-xs font-semibold text-zinc-950 shadow-lg transition-colors hover:bg-sky-300"
              >
                Use this area (Enter)
              </button>
              <button
                type="button"
                onClick={() => void cancel()}
                className="h-8 rounded-lg border border-white/15 bg-zinc-950/90 px-3 text-xs font-medium text-zinc-200 shadow-lg transition-colors hover:bg-zinc-800"
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
