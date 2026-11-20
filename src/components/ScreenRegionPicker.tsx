import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriApp } from "../services/tauri.service";
import type { CaptureRegion, DisplayInfo } from "../types";

export type AreaPickRequest = {
  id: number;
  startAfter: boolean;
};

type Props = {
  display: DisplayInfo | null;
  captureRegion: CaptureRegion | null;
  disabled?: boolean;
  pickRequest: AreaPickRequest | null;
  onCaptureRegionChange: (region: CaptureRegion | null) => Promise<void>;
  onSelectionComplete?: (region: CaptureRegion) => Promise<void>;
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

export function ScreenRegionPicker({
  display,
  captureRegion,
  disabled = false,
  pickRequest,
  onCaptureRegionChange,
  onSelectionComplete,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const handledRequestId = useRef<number>(0);

  const beginPicking = useCallback(
    async (shouldStartAfterSelection: boolean) => {
      if (!display || disabled) return;
      setError(null);

      try {
        if (!isTauriApp()) {
          const fallbackRegion: CaptureRegion = {
            x: Math.round(display.width * 0.12),
            y: Math.round(display.height * 0.12),
            width: alignedWithinBounds(Math.round(display.width * 0.72), display.width),
            height: alignedWithinBounds(Math.round(display.height * 0.72), display.height),
          };
          await onCaptureRegionChange(fallbackRegion);
          if (shouldStartAfterSelection) {
            await onSelectionComplete?.(fallbackRegion);
          }
          return;
        }

        // Close any stale picker window before opening a fresh one
        try {
          const existing = await WebviewWindow.getByLabel(PICKER_WINDOW_LABEL);
          if (existing) {
            await existing.close();
          }
        } catch {
          // Ignore if no prior picker window exists
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

        const params = new URLSearchParams({
          picker: "1",
          displayWidth: String(display.width),
          displayHeight: String(display.height),
        });
        if (captureRegion) {
          params.set("initX", String(captureRegion.x));
          params.set("initY", String(captureRegion.y));
          params.set("initW", String(captureRegion.width));
          params.set("initH", String(captureRegion.height));
        }

        const picker = new WebviewWindow(PICKER_WINDOW_LABEL, {
          url: `/?${params.toString()}`,
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
      }
    },
    [captureRegion, disabled, display, onCaptureRegionChange, onSelectionComplete],
  );

  useEffect(() => {
    if (!pickRequest || pickRequest.id === handledRequestId.current) return;
    handledRequestId.current = pickRequest.id;
    void beginPicking(pickRequest.startAfter);
  }, [beginPicking, pickRequest]);

  if (!error) return null;
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
      {error}
    </div>
  );
}
