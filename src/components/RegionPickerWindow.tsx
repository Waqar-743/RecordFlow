import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CaptureRegion } from "../types";

type Point = {
  x: number;
  y: number;
};

type SelectionRect = Point & {
  width: number;
  height: number;
};

const MIN_SELECTION_SIZE = 24;
const H264_DIMENSION_ALIGNMENT = 16;

function normalizeRect(start: Point, end: Point): SelectionRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return { x, y, width, height };
}

function readDisplaySize() {
  const params = new URLSearchParams(window.location.search);
  return {
    width: Number(params.get("displayWidth")) || window.innerWidth,
    height: Number(params.get("displayHeight")) || window.innerHeight,
  };
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

export function RegionPickerWindow() {
  const displaySize = useMemo(readDisplaySize, []);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeRect = useMemo(() => {
    if (!dragStart || !dragEnd) return null;
    return normalizeRect(dragStart, dragEnd);
  }, [dragEnd, dragStart]);

  const close = async () => {
    await emit("region-picker:cancelled");
    await getCurrentWebviewWindow().close();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 2) return;

    const next = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setError(null);
    setDragStart(next);
    setDragEnd(next);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    setDragEnd({ x: event.clientX, y: event.clientY });
  };

  const onPointerUp = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;

    const rect = normalizeRect(dragStart, { x: event.clientX, y: event.clientY });
    if (rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
      setDragStart(null);
      setDragEnd(null);
      setError("Selection is too small.");
      return;
    }

    const scaleX = displaySize.width / Math.max(window.innerWidth, 1);
    const scaleY = displaySize.height / Math.max(window.innerHeight, 1);
    const x = Math.max(0, Math.round(rect.x * scaleX));
    const y = Math.max(0, Math.round(rect.y * scaleY));
    const region: CaptureRegion = {
      x,
      y,
      width: alignedWithinBounds(Math.round(rect.width * scaleX), displaySize.width - x),
      height: alignedWithinBounds(Math.round(rect.height * scaleY), displaySize.height - y),
    };

    await emit("region-picker:selected", { region });
    await getCurrentWebviewWindow().close();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void close();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="rf-region-picker rf-region-picker-window"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => void onPointerUp(event)}
    >
      <div className="rf-region-picker-hint">
        Right-drag to select the exact recording area. Press Esc to cancel.
      </div>

      <button className="rf-region-picker-cancel" onClick={() => void close()} type="button">
        Cancel
      </button>

      {error ? <div className="rf-region-picker-error">{error}</div> : null}

      {activeRect ? (
        <div
          className="rf-region-picker-selection"
          style={{
            left: activeRect.x,
            top: activeRect.y,
            width: activeRect.width,
            height: activeRect.height,
          }}
        >
          <span>
            Recording area: {Math.round(activeRect.width)} x {Math.round(activeRect.height)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
