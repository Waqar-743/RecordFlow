import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { isTauriApp } from "../services/tauri.service";
import type { RecordingStatus } from "../types";
import { EyeOffIcon, FileTextIcon, PauseIcon, PlayIcon, RotateCcwIcon, XIcon } from "./Icons";

const STORAGE_KEY = "recordflow_teleprompter_script_v1";
const DEFAULT_SCRIPT =
  "Welcome to this walkthrough!\n\nToday I'll show the core workflow step by step.\n\nNotice how effortlessly you can read your talking points — this Script panel is excluded from screen capture so viewers never see it.";

type Props = {
  standalone?: boolean;
  isOpen?: boolean;
  isRecording?: boolean;
  isPaused?: boolean;
  onClose?: () => void;
};

export function TeleprompterWindow({
  standalone = false,
  isOpen = true,
  isRecording: propIsRecording = false,
  isPaused: propIsPaused = false,
  onClose,
}: Props) {
  const [scriptText, setScriptText] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SCRIPT;
    } catch {
      return DEFAULT_SCRIPT;
    }
  });
  const [isScrolling, setIsScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(2);
  const [fontSize, setFontSize] = useState(15);
  const [opacity, setOpacity] = useState(96);
  const [liveRecording, setLiveRecording] = useState(propIsRecording);
  const [livePaused, setLivePaused] = useState(propIsPaused);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, scriptText);
    } catch {
      /* ignore */
    }
  }, [scriptText]);

  useEffect(() => {
    if (standalone) return;
    setLiveRecording(propIsRecording);
    setLivePaused(propIsPaused);
  }, [propIsPaused, propIsRecording, standalone]);

  useEffect(() => {
    if (!standalone || !isTauriApp()) return;
    void getCurrentWebviewWindow()
      .setContentProtected(true)
      .catch(() => {});

    const unlistenPromise = listen<RecordingStatus>("recording_status", (event) => {
      setLiveRecording(event.payload.is_recording);
      setLivePaused(event.payload.is_paused);
    });

    return () => {
      void unlistenPromise.then((fn) => fn());
    };
  }, [standalone]);

  useEffect(() => {
    if (liveRecording && !livePaused) {
      setIsScrolling(true);
    } else {
      setIsScrolling(false);
    }
  }, [livePaused, liveRecording]);

  useEffect(() => {
    if (!isScrolling) return;
    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop += scrollSpeed * 22 * dt;
      }
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [isScrolling, scrollSpeed]);

  if (!standalone && !isOpen) return null;

  const handleClose = async () => {
    if (standalone && isTauriApp()) {
      await getCurrentWebviewWindow().close();
      return;
    }
    onClose?.();
  };

  const containerClass = standalone
    ? "flex h-screen w-screen flex-col overflow-hidden select-none"
    : "rf-pop-in fixed bottom-20 right-6 z-40 flex h-[390px] w-[360px] flex-col overflow-hidden rounded-2xl select-none";

  return (
    <div
      className={containerClass}
      style={{
        opacity: opacity / 100,
        background: "var(--surface)",
        color: "var(--text)",
        border: standalone ? undefined : "1px solid var(--border-strong)",
        boxShadow: standalone ? undefined : "var(--shadow-lg)",
      }}
    >
      {/* Header / Drag Region */}
      <div
        data-tauri-drag-region={standalone ? "" : undefined}
        className="flex cursor-move items-center justify-between px-3.5 py-2.5"
        style={{
          background: "var(--bg-elev)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          data-tauri-drag-region={standalone ? "" : undefined}
          className="flex min-w-0 items-center gap-2"
        >
          <FileTextIcon className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} />
          <span className="truncate text-xs font-semibold">Presenter Script</span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: "var(--success-soft)", color: "var(--success)" }}
          >
            <EyeOffIcon className="h-2.5 w-2.5" />
            Hidden in capture
          </span>
        </div>
        <button
          type="button"
          onClick={() => void handleClose()}
          aria-label="Close script panel"
          className="rounded-md p-1 transition-colors"
          style={{ color: "var(--text-2)" }}
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Controls Bar */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]"
        style={{
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsScrolling((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold transition-colors"
            style={
              isScrolling
                ? { background: "var(--accent)", color: "var(--accent-fg)" }
                : { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }
            }
          >
            {isScrolling ? <PauseIcon className="h-3 w-3" /> : <PlayIcon className="h-3 w-3" />}
            <span>{isScrolling ? "Pause" : "Auto-scroll"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
            }}
            title="Rewind to top"
            className="rounded-lg p-1.5"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-2)" }}
          >
            <RotateCcwIcon className="h-3 w-3" />
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <label className="flex items-center gap-1.5" style={{ color: "var(--text-2)" }}>
            <span>Speed</span>
            <input
              type="range"
              min="1"
              max="5"
              step="0.5"
              value={scrollSpeed}
              onChange={(e) => setScrollSpeed(Number(e.target.value))}
              className="rf-slider w-14"
            />
          </label>

          <label className="flex items-center gap-1.5" style={{ color: "var(--text-2)" }}>
            <span>Alpha</span>
            <input
              type="range"
              min="50"
              max="100"
              step="5"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="rf-slider w-12"
            />
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.max(12, s - 2))}
              className="rounded px-1.5 py-0.5 text-[11px]"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.min(28, s + 2))}
              className="rounded px-1.5 py-0.5 text-[11px]"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              A+
            </button>
          </div>
        </div>
      </div>

      {/* Script Area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 rf-scroll">
        <textarea
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder="Type or paste your presenter notes here…"
          rows={14}
          className="h-full min-h-[260px] w-full resize-none bg-transparent leading-relaxed outline-none select-text"
          style={{ fontSize: `${fontSize}px`, color: "var(--text)" }}
        />
      </div>
    </div>
  );
}
