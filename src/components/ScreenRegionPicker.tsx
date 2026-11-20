import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriApp, tauriService } from "../services/tauri.service";
import type { CaptureRegion, DisplayInfo } from "../types";
import { InlineRegionOverlay } from "./InlineRegionOverlay";

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
  onCancelled?: () => void;
};

const PICKER_WINDOW_LABEL = "region-picker";

export function ScreenRegionPicker({
  display,
  captureRegion,
  disabled = false,
  pickRequest,
  onCaptureRegionChange,
  onSelectionComplete,
  onCancelled,
}: Props) {
  const [browserOverlayRequest, setBrowserOverlayRequest] = useState<AreaPickRequest | null>(null);
  const handledRequestId = useRef<number>(0);

  const restoreMain = useCallback(async () => {
    if (!isTauriApp()) return;
    try {
      await tauriService.restoreMainWindow();
    } catch {
      /* ignore */
    }
  }, []);

  const beginPicking = useCallback(
    async (req: AreaPickRequest) => {
      if (!display || disabled) return;

      // Browser mode: render full-viewport translucent interactive overlay directly
      if (!isTauriApp()) {
        setBrowserOverlayRequest(req);
        return;
      }

      try {
        // Close any stale picker window first
        try {
          const existing = await WebviewWindow.getByLabel(PICKER_WINDOW_LABEL);
          if (existing) await existing.close();
        } catch {
          /* ignore */
        }

        // Immediately hide/minimize the main application window per spec
        try {
          await tauriService.minimizeMainWindow();
        } catch {
          /* ignore */
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
              await restoreMain();
              if (req.startAfter) {
                await onSelectionComplete?.(region);
              }
            })();
          },
        );

        unlistenCancelled = await listen("region-picker:cancelled", () => {
          cleanup();
          void restoreMain();
          onCancelled?.();
        });

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
            void restoreMain();
            reject(event.payload);
          });
        });
      } catch {
        await restoreMain();
      }
    },
    [captureRegion, disabled, display, onCancelled, onCaptureRegionChange, onSelectionComplete, restoreMain],
  );

  useEffect(() => {
    if (!pickRequest || pickRequest.id === handledRequestId.current) return;
    handledRequestId.current = pickRequest.id;
    void beginPicking(pickRequest);
  }, [beginPicking, pickRequest]);

  if (!browserOverlayRequest || !display) return null;

  return (
    <InlineRegionOverlay
      display={display}
      initialRegion={captureRegion}
      onConfirm={(region) => {
        const startAfter = browserOverlayRequest.startAfter;
        setBrowserOverlayRequest(null);
        void (async () => {
          await onCaptureRegionChange(region);
          if (startAfter) {
            await onSelectionComplete?.(region);
          }
        })();
      }}
      onCancel={() => {
        setBrowserOverlayRequest(null);
        onCancelled?.();
      }}
    />
  );
}
