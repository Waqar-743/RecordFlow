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

        unlistenSelected = await listen<{ region: CaptureRegion; startRecording?: boolean }>(
          "region-picker:selected",
          (event) => {
            cleanup();
            void (async () => {
              const region = event.payload.region;
              const shouldStart = Boolean(event.payload.startRecording ?? req.startAfter);
              await onCaptureRegionChange(region);
              await restoreMain();
              if (shouldStart) {
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

        // Do NOT pass any pre-decided initX/initY/initW/initH — always let the user drag a fresh area.
        const params = new URLSearchParams({
          picker: "1",
          displayWidth: String(display.width),
          displayHeight: String(display.height),
        });

        const dpr = window.devicePixelRatio || 1;
        const logicalX = Math.round(display.x / dpr);
        const logicalY = Math.round(display.y / dpr);
        const logicalW = Math.max(320, Math.round(display.width / dpr));
        const logicalH = Math.max(240, Math.round(display.height / dpr));

        const picker = new WebviewWindow(PICKER_WINDOW_LABEL, {
          url: `/?${params.toString()}`,
          x: logicalX,
          y: logicalY,
          width: logicalW,
          height: logicalH,
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
      } catch {
        // Fallback to inline full-window region selector if OS blocks transparent secondary window
        await restoreMain();
        setBrowserOverlayRequest(req);
      }
    },
    [disabled, display, onCancelled, onCaptureRegionChange, onSelectionComplete, restoreMain],
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
      initialRegion={null}
      onConfirm={(region, startRecording) => {
        const shouldStart = startRecording || browserOverlayRequest.startAfter;
        setBrowserOverlayRequest(null);
        void (async () => {
          await onCaptureRegionChange(region);
          if (shouldStart) {
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
