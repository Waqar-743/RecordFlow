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
import { CheckIcon, RecordDotIcon, RotateCcwIcon } from "./Icons";

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
  return { displayWidth, displayHeight };
}

export function RegionPickerWindow() {
  const { displayWidth, displayHeight } = useMemo(readParams, []);
  // Always start with null selection so the user draws their own area
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
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

  const confirm = useCallback(
    async (startRecording: boolean) => {
      if (!selection || selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE) {
        setError("Click and drag a capture area at least 64 × 64 pixels.");
        return;
      }
      const region = toAlignedRegion(selection);
      await emit("region-picker:selected", { region, startRecording });
      await getCurrentWebviewWindow().close();
    },
    [selection, toAlignedRegion],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void cancel();
      } else if (event.key === "Enter" && selection) {
        event.preventDefault();
        void confirm(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, confirm, selection]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, mode: DragMode) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.stopPropagation();
    setError(null);
    setIsDragging(true);
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
    setIsDragging(false);
    if (drag?.mode === "new") {
      setSelection((curr) => {
        if (!curr || curr.width < MIN_SELECTION_SIZE || curr.height < MIN_SELECTION_SIZE) {
          setError("Drag a larger area on screen (minimum 64 × 64 pixels).");
          return null;
        }
        return curr;
      });
    }
  };

  const alignedPreview =
    selection && selection.width >= 16 && selection.height >= 16
      ? toAlignedRegion(selection)
      : null;

  const canConfirm =
    selection !== null &&
    selection.width >= MIN_SELECTION_SIZE &&
    selection.height >= MIN_SELECTION_SIZE;

  const toolbarBelow = selection ? selection.y + selection.height < window.innerHeight - 76 : true;

  return (
    <div
      className="rf-region-picker"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(e) => startDrag(e, "new")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Top guidance bar */}
      <div
        className="fixed left-1/2 top-6 z-10 -translate-x-1/2 flex items-center gap-3 rounded-full px-5 py-2.5 text-xs font-medium shadow-2xl"
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
        <span>
          {canConfirm
            ? "Drag corners to fine-tune area, then click Record this area"
            : "Click and drag anywhere on screen to select the recording area"}
        </span>
        <span className="opacity-40">·</span>
        <span className="font-mono text-[11px] opacity-80">Esc to cancel</span>
        <button
          type="button"
          onClick={() => void cancel()}
          className="ml-1 rounded-full px-3 py-1 text-[11px] font-semibold"
          style={{ background: "rgba(255,235,225,0.14)", color: "#ffffff" }}
        >
          Cancel
        </button>
      </div>

      {/* Center prompt when user hasn't dragged an area yet */}
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
            Release to record the selected region or adjust its handles
          </div>
        </div>
      )}

      {error && (
        <div
          className="fixed left-1/2 top-20 z-10 -translate-x-1/2 rounded-xl px-4 py-2 text-xs font-medium shadow-xl"
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

          {/* Live dimension badge while dragging */}
          {alignedPreview && (
            <div
              className="pointer-events-none absolute left-2 top-2 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold shadow"
              style={{
                background: "rgba(20, 14, 14, 0.9)",
                color: "var(--accent)",
                border: "1px solid rgba(255, 107, 74, 0.4)",
              }}
            >
              {alignedPreview.width} × {alignedPreview.height}
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

          {!isDragging && canConfirm && alignedPreview && (
            <div
              className="rf-region-toolbar"
              style={toolbarBelow ? { top: "calc(100% + 12px)" } : { bottom: "calc(100% + 12px)" }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span
                className="inline-flex h-9 items-center rounded-xl px-3 font-mono text-xs font-semibold shadow-lg"
                style={{
                  background: "rgba(20, 15, 15, 0.95)",
                  border: "1px solid rgba(255, 235, 225, 0.16)",
                  color: "var(--accent)",
                }}
              >
                {alignedPreview.width} × {alignedPreview.height}
              </span>

              <button
                type="button"
                onClick={() => void confirm(true)}
                className="rf-btn-primary inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold shadow-lg"
              >
                <RecordDotIcon className="h-3.5 w-3.5" />
                <span>Record this area (Enter)</span>
              </button>

              <button
                type="button"
                onClick={() => void confirm(false)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold shadow-lg"
                style={{
                  background: "rgba(24, 18, 18, 0.95)",
                  border: "1px solid rgba(255, 235, 225, 0.22)",
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
                className="inline-flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-medium shadow-lg"
                style={{
                  background: "rgba(20, 15, 15, 0.92)",
                  border: "1px solid rgba(255, 235, 225, 0.16)",
                  color: "#d4c3c0",
                }}
              >
                <RotateCcwIcon className="h-3 w-3" />
                <span>Redraw</span>
              </button>

              <button
                type="button"
                onClick={() => void cancel()}
                className="h-9 rounded-xl px-3 text-xs font-medium shadow-lg"
                style={{
                  background: "rgba(20, 15, 15, 0.92)",
                  border: "1px solid rgba(255, 235, 225, 0.16)",
                  color: "#f0e6e4",
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
