import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isTauriApp, tauriService } from "../services/tauri.service";
import type { RecordingStatus } from "../types";
import { EyeOffIcon, PauseIcon, PlayIcon, StopIcon } from "./Icons";

export const FLOATING_CONTROLS_POS_KEY = "recordflow_floating_controls_pos_v1";
export const FLOATING_CONTROLS_WIDTH = 252;
export const FLOATING_CONTROLS_HEIGHT = 54;

type Props = {
  standalone?: boolean;
  isRecording?: boolean;
  isPaused?: boolean;
  elapsedSeconds?: number;
  loading?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
};

function formatElapsed(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 16" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="2.5" cy="3" r="1.35" />
      <circle cx="7.5" cy="3" r="1.35" />
      <circle cx="2.5" cy="8" r="1.35" />
      <circle cx="7.5" cy="8" r="1.35" />
      <circle cx="2.5" cy="13" r="1.35" />
      <circle cx="7.5" cy="13" r="1.35" />
    </svg>
  );
}

/**
 * Compact, draggable, always-on-top floating recording control pill.
 * In Tauri desktop mode (`standalone`), it runs in a transparent borderless window with
 * `setContentProtected(true)` (`WDA_EXCLUDEFROMCAPTURE`) so it floats freely over all
 * apps while remaining 100% invisible inside the recorded video.
 */
export function FloatingRecordingControls({
  standalone = false,
  isRecording: propRecording = false,
  isPaused: propPaused = false,
  elapsedSeconds: propElapsed = 0,
  loading: propLoading = false,
  onPause,
  onResume,
  onStop,
}: Props) {
  const [status, setStatus] = useState<RecordingStatus>({
    is_recording: standalone ? true : propRecording,
    is_paused: propPaused,
    output_file: null,
    elapsed_seconds: propElapsed,
  });
  const [busyAction, setBusyAction] = useState<"pause" | "stop" | null>(null);
  const sawRecordingRef = useRef(false);

  // Inline browser fallback drag state (only used when !standalone)
  const [inlinePos, setInlinePos] = useState<{ x: number; y: number }>(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 760;
    return {
      x: Math.max(16, vw - FLOATING_CONTROLS_WIDTH - 24),
      y: Math.max(16, vh - FLOATING_CONTROLS_HEIGHT - 24),
    };
  });
  const inlineDragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Sync props when used as an inline browser overlay
  useEffect(() => {
    if (standalone) return;
    setStatus({
      is_recording: propRecording,
      is_paused: propPaused,
      output_file: null,
      elapsed_seconds: propElapsed,
    });
  }, [propElapsed, propPaused, propRecording, standalone]);

  // Configure transparent, capture-excluded native Tauri window & live status sync
  useEffect(() => {
    if (!standalone) return;
    document.documentElement.classList.add("rf-floating-controls-mode");

    if (!isTauriApp()) {
      return () => {
        document.documentElement.classList.remove("rf-floating-controls-mode");
      };
    }

    const win = getCurrentWebviewWindow();
    void win.setContentProtected(true).catch(() => {});
    void win.setAlwaysOnTop(true).catch(() => {});

    let closed = false;
    const closeSelf = () => {
      if (closed) return;
      closed = true;
      void win.close().catch(() => {});
    };

    const applyStatus = (next: RecordingStatus) => {
      setStatus(next);
      if (next.is_recording) {
        sawRecordingRef.current = true;
      } else if (sawRecordingRef.current) {
        closeSelf();
      }
    };

    void tauriService
      .getRecordingStatus()
      .then((s) => {
        applyStatus(s);
        if (!s.is_recording) {
          // If opened after recording already ended, close cleanly
          window.setTimeout(() => {
            if (!sawRecordingRef.current) closeSelf();
          }, 800);
        }
      })
      .catch(() => {});

    const unlistenStatus = listen<RecordingStatus>("recording_status", (event) => {
      applyStatus(event.payload);
    });

    // Save dragged window position (logical pixels) so RecordFlow remembers the user's preferred spot
    let saveTimer: number | null = null;
    const unlistenMoved = win.onMoved(({ payload }) => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        try {
          const dpr = window.devicePixelRatio || 1;
          window.localStorage.setItem(
            FLOATING_CONTROLS_POS_KEY,
            JSON.stringify({
              x: Math.round(payload.x / dpr),
              y: Math.round(payload.y / dpr),
            }),
          );
        } catch {
          /* ignore storage errors */
        }
      }, 180);
    });

    // Lightweight fallback poll in case an event is missed
    const pollId = window.setInterval(() => {
      void tauriService
        .getRecordingStatus()
        .then(applyStatus)
        .catch(() => {});
    }, 1000);

    return () => {
      document.documentElement.classList.remove("rf-floating-controls-mode");
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      window.clearInterval(pollId);
      void unlistenStatus.then((fn) => fn());
      void unlistenMoved.then((fn) => fn());
    };
  }, [standalone]);

  const handleTogglePause = async () => {
    if (busyAction || propLoading) return;
    if (!standalone) {
      if (status.is_paused) onResume?.();
      else onPause?.();
      return;
    }
    setBusyAction("pause");
    try {
      if (status.is_paused) {
        await tauriService.resumeRecording();
      } else {
        await tauriService.pauseRecording();
      }
      const next = await tauriService.getRecordingStatus().catch(() => null);
      if (next) setStatus(next);
    } catch {
      /* ignore transient errors */
    } finally {
      setBusyAction(null);
    }
  };

  const handleStop = async () => {
    if (busyAction === "stop" || propLoading) return;
    if (!standalone) {
      onStop?.();
      return;
    }
    setBusyAction("stop");
    try {
      await tauriService.stopRecording();
    } catch {
      /* backend will emit final status */
    } finally {
      if (isTauriApp()) {
        void getCurrentWebviewWindow().close().catch(() => {});
      }
    }
  };

  // Drag handler: native OS window drag in Tauri standalone mode, pointer drag in browser fallback
  const handlePillPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) return;

    if (standalone && isTauriApp()) {
      void getCurrentWebviewWindow().startDragging().catch(() => {});
      return;
    }

    inlineDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: inlinePos.x,
      origY: inlinePos.y,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleInlinePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = inlineDragRef.current;
    if (!drag) return;
    const maxX = Math.max(8, window.innerWidth - FLOATING_CONTROLS_WIDTH - 8);
    const maxY = Math.max(8, window.innerHeight - FLOATING_CONTROLS_HEIGHT - 8);
    setInlinePos({
      x: Math.max(8, Math.min(maxX, drag.origX + (e.clientX - drag.startX))),
      y: Math.max(8, Math.min(maxY, drag.origY + (e.clientY - drag.startY))),
    });
  };

  const handleInlinePointerUp = () => {
    inlineDragRef.current = null;
  };

  if (!standalone && !status.is_recording) return null;

  const isPaused = status.is_paused;
  const isStopping = busyAction === "stop" || propLoading;

  const pillContent = (
    <div
      data-tauri-drag-region
      onPointerDown={handlePillPointerDown}
      onPointerMove={!standalone ? handleInlinePointerMove : undefined}
      onPointerUp={!standalone ? handleInlinePointerUp : undefined}
      onPointerCancel={!standalone ? handleInlinePointerUp : undefined}
      onContextMenu={(e) => e.preventDefault()}
      title="Drag anywhere · Excluded from screen recording"
      className="flex h-[46px] w-full items-center justify-between gap-2 rounded-full px-2.5 select-none cursor-grab active:cursor-grabbing"
      style={{
        background: "rgba(18, 13, 13, 0.94)",
        border: "1px solid rgba(255, 235, 225, 0.2)",
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.52), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
        color: "#f7f1ee",
      }}
    >
      {/* Left: Drag grip + capture-hidden icon + live timer */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 pl-0.5"
      >
        <span
          data-tauri-drag-region
          className="flex items-center justify-center opacity-50 hover:opacity-90 transition-opacity"
          title="Drag pill anywhere on screen"
        >
          <GripIcon className="h-3.5 w-2.5" />
        </span>

        <span
          data-tauri-drag-region
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${!isPaused && !isStopping ? "rf-rec-dot" : ""}`}
          style={{ background: isPaused ? "#f59e0b" : "#ef4444" }}
        />

        <span
          data-tauri-drag-region
          className="font-mono text-xs font-semibold tabular-nums tracking-tight"
          style={{ color: "#fffaf7", minWidth: "40px" }}
        >
          {formatElapsed(status.elapsed_seconds)}
        </span>

        {standalone && (
          <span
            data-tauri-drag-region
            title="Invisible in recording (excluded from capture)"
            className="opacity-45"
          >
            <EyeOffIcon className="h-3 w-3" />
          </span>
        )}
      </div>

      {/* Right: Pause/Resume & Stop controls */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={Boolean(busyAction) || propLoading}
          onClick={() => void handleTogglePause()}
          title={isPaused ? "Resume recording" : "Pause recording"}
          aria-label={isPaused ? "Resume recording" : "Pause recording"}
          className="flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer disabled:opacity-50"
          style={{
            background: isPaused ? "rgba(245, 158, 11, 0.2)" : "rgba(255, 235, 225, 0.11)",
            border: `1px solid ${isPaused ? "rgba(245, 158, 11, 0.45)" : "rgba(255, 235, 225, 0.16)"}`,
            color: isPaused ? "#fbbf24" : "#f7f1ee",
          }}
        >
          {isPaused ? (
            <PlayIcon className="h-3.5 w-3.5" />
          ) : (
            <PauseIcon className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          type="button"
          disabled={isStopping}
          onClick={() => void handleStop()}
          title="Stop recording & open in Edit Studio"
          aria-label="Stop recording"
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 cursor-pointer disabled:opacity-60"
          style={{
            background: "#ef4444",
            boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)",
          }}
        >
          <StopIcon className="h-3 w-3" />
          <span>{isStopping ? "Saving…" : "Stop"}</span>
        </button>
      </div>
    </div>
  );

  if (standalone) {
    return (
      <div className="flex h-screen w-screen items-center justify-center p-1 bg-transparent overflow-hidden">
        {pillContent}
      </div>
    );
  }

  return (
    <div
      className="fixed z-50"
      style={{
        left: inlinePos.x,
        top: inlinePos.y,
        width: FLOATING_CONTROLS_WIDTH,
        height: FLOATING_CONTROLS_HEIGHT,
      }}
    >
      <div className="flex h-full w-full items-center justify-center p-1">{pillContent}</div>
    </div>
  );
}
