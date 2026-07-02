import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriApp } from "../services/tauri.service";
import type { CaptureRegion, DisplayInfo } from "../types";

type Point = {
  x: number;
  y: number;
};

type SelectionRect = Point & {
  width: number;
  height: number;
};

type Props = {
  display: DisplayInfo | null;
  captureRegion: CaptureRegion | null;
  disabled?: boolean;
  onCaptureRegionChange: (region: CaptureRegion | null) => Promise<void>;
};

const MIN_SELECTION_SIZE = 24;
const RESTORED_WINDOW_SIZE = { width: 1100, height: 750 };

function normalizeRect(start: Point, end: Point): SelectionRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return { x, y, width, height };
}

function formatRegion(region: CaptureRegion | null, display: DisplayInfo | null): string {
  if (!region) {
    return display ? `${display.width}x${display.height} full display` : "Full display";
  }

  return `${region.width}x${region.height} at ${region.x}, ${region.y}`;
}

async function preparePickerWindow(display: DisplayInfo | null) {
  if (!isTauriApp() || !display) return;

  const appWindow = getCurrentWindow();
  await appWindow.setFullscreen(false);
  await appWindow.setAlwaysOnTop(true);
  await appWindow.setPosition(new PhysicalPosition(display.x, display.y));
  await appWindow.setSize(new PhysicalSize(display.width, display.height));
  await appWindow.setFullscreen(true);
  await appWindow.setFocus();
}

async function restorePickerWindow() {
  if (!isTauriApp()) return;

  const appWindow = getCurrentWindow();
  await appWindow.setFullscreen(false);
  await appWindow.setAlwaysOnTop(false);
  await appWindow.setSize(new PhysicalSize(RESTORED_WINDOW_SIZE.width, RESTORED_WINDOW_SIZE.height));
  await appWindow.center();
  await appWindow.setFocus();
}

export function ScreenRegionPicker({
  display,
  captureRegion,
  disabled = false,
  onCaptureRegionChange,
}: Props) {
  const [isPicking, setIsPicking] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeRect = useMemo(() => {
    if (!dragStart || !dragEnd) return null;
    return normalizeRect(dragStart, dragEnd);
  }, [dragEnd, dragStart]);

  const beginPicking = async () => {
    if (!display || disabled) return;

    setError(null);
    setIsPreparing(true);
    setIsPicking(true);
    setDragStart(null);
    setDragEnd(null);

    try {
      await preparePickerWindow(display);
    } catch (e) {
      setError(String(e));
      setIsPicking(false);
    } finally {
      setIsPreparing(false);
    }
  };

  const closePicker = async () => {
    setIsPicking(false);
    setDragStart(null);
    setDragEnd(null);

    try {
      await restorePickerWindow();
    } catch (e) {
      setError(String(e));
    }
  };

  const useFullDisplay = async () => {
    setError(null);
    await onCaptureRegionChange(null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isPreparing) return;

    const next = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(next);
    setDragEnd(next);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    setDragEnd({ x: event.clientX, y: event.clientY });
  };

  const onPointerUp = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!display || !dragStart) return;

    const viewportWidth = Math.max(window.innerWidth, 1);
    const viewportHeight = Math.max(window.innerHeight, 1);
    const rect = normalizeRect(dragStart, { x: event.clientX, y: event.clientY });

    if (rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
      setDragStart(null);
      setDragEnd(null);
      setError("Selection is too small.");
      return;
    }

    const scaleX = display.width / viewportWidth;
    const scaleY = display.height / viewportHeight;
    const nextRegion: CaptureRegion = {
      x: Math.max(0, Math.round(rect.x * scaleX)),
      y: Math.max(0, Math.round(rect.y * scaleY)),
      width: Math.max(1, Math.round(rect.width * scaleX)),
      height: Math.max(1, Math.round(rect.height * scaleY)),
    };

    try {
      await onCaptureRegionChange(nextRegion);
      await closePicker();
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    if (!isPicking) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void closePicker();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPicking]);

  return (
    <>
      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase">Capture Area</div>
            <div className="text-sm font-medium text-gray-800">{formatRegion(captureRegion, display)}</div>
          </div>

          <div className="flex gap-2">
            <button
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || !display}
              onClick={() => void useFullDisplay()}
              type="button"
            >
              Full display
            </button>
            <button
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || !display}
              onClick={() => void beginPicking()}
              type="button"
            >
              Select area
            </button>
          </div>
        </div>

        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>

      {isPicking ? (
        <div
          className="rf-region-picker"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => void onPointerUp(event)}
        >
          <div className="rf-region-picker-hint">
            {isPreparing ? "Preparing selection..." : "Drag to select. Press Esc to cancel."}
          </div>

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
                {Math.round(activeRect.width)} x {Math.round(activeRect.height)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
