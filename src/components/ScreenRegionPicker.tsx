import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { isTauriApp } from "../services/tauri.service";
import type { CaptureRegion, DisplayInfo } from "../types";

type Props = {
  display: DisplayInfo | null;
  captureRegion: CaptureRegion | null;
  disabled?: boolean;
  showControls?: boolean;
  selectionRequestId?: number;
  onCaptureRegionChange: (region: CaptureRegion | null) => Promise<void>;
  onSelectionComplete?: (region: CaptureRegion | null) => Promise<void>;
};

const PICKER_WINDOW_LABEL = "region-picker";
const H264_DIMENSION_ALIGNMENT = 16;

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

function formatRegion(region: CaptureRegion | null, display: DisplayInfo | null): string {
  if (!region) {
    return display ? `${display.width}x${display.height} full display` : "Full display";
  }

  return `${region.width}x${region.height} at ${region.x}, ${region.y}`;
}

export function ScreenRegionPicker({
  display,
  captureRegion,
  disabled = false,
  showControls = true,
  selectionRequestId = 0,
  onCaptureRegionChange,
  onSelectionComplete,
}: Props) {
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledSelectionRequest = useRef(selectionRequestId);

  const beginPicking = async (shouldStartAfterSelection = false) => {
    if (!display || disabled) return;

    setError(null);
    setIsPreparing(true);

    try {
      if (!isTauriApp()) {
        const fallbackRegion = {
          x: 0,
          y: 0,
          width: alignedWithinBounds(Math.round(display.width * 0.75), display.width),
          height: alignedWithinBounds(Math.round(display.height * 0.75), display.height),
        };
        await onCaptureRegionChange(fallbackRegion);
        if (shouldStartAfterSelection) {
          await onSelectionComplete?.(fallbackRegion);
        }
        return;
      }

      let unlistenSelected: (() => void) | null = null;
      let unlistenCancelled: (() => void) | null = null;
      const cleanup = () => {
        unlistenSelected?.();
        unlistenCancelled?.();
        unlistenSelected = null;
        unlistenCancelled = null;
      };

      unlistenSelected = await listen<{ region: CaptureRegion }>(
        "region-picker:selected",
        (event) => {
          cleanup();
          void (async () => {
            const region = event.payload.region;
            await onCaptureRegionChange(region);
            if (shouldStartAfterSelection) {
              await onSelectionComplete?.(region);
            }
          })();
        },
      );
      unlistenCancelled = await listen("region-picker:cancelled", cleanup);

      const picker = new WebviewWindow(PICKER_WINDOW_LABEL, {
        url: `/?picker=1&displayWidth=${display.width}&displayHeight=${display.height}`,
        x: display.x,
        y: display.y,
        width: display.width,
        height: display.height,
        decorations: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: true,
        visible: true,
        focus: true,
      });

      await new Promise<void>((resolve, reject) => {
        void picker.once("tauri://created", () => resolve());
        void picker.once("tauri://error", (event) => {
          cleanup();
          reject(event.payload);
        });
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setIsPreparing(false);
    }
  };

  const useFullDisplay = async () => {
    setError(null);
    await onCaptureRegionChange(null);
  };


  useEffect(() => {
    if (!selectionRequestId || selectionRequestId === handledSelectionRequest.current) return;

    handledSelectionRequest.current = selectionRequestId;
    void beginPicking(true);
  }, [selectionRequestId, display, disabled]);

  if (!showControls) {
    return error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null;
  }

  return (
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
            disabled={disabled || !display || isPreparing}
            onClick={() => void beginPicking(false)}
            type="button"
          >
            {isPreparing ? "Opening..." : "Select area"}
          </button>
        </div>
      </div>

      {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
    </div>
  );
}
