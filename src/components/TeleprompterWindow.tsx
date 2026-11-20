import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { isTauriApp } from "../services/tauri.service";
import type { RecordingStatus } from "../types";
import { EyeOffIcon, FileTextIcon, PauseIcon, PlayIcon, RotateCcwIcon, XIcon } from "./Icons";

const STORAGE_KEY = "recordflow_teleprompter_script_v1";
const DEFAULT_SCRIPT =
  "Welcome to this demo!\n\nToday I'll walk through the key workflow step by step.\n\nNotice how smoothly everything stays focused — this script window is excluded from screen capture so viewers never see it.";

type Props = {
  /** True when mounted in its own capture-excluded always-on-top Tauri window (`/?teleprompter=1`). */
  standalone?: boolean;
  /** Used in browser-dev floating overlay mode. */
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
  const [fontSize, setFontSize] = useState(16);
  const [opacity, setOpacity] = useState(92);
  const [liveRecording, setLiveRecording] = useState(propIsRecording);
  const [livePaused, setLivePaused] = useState(propIsPaused);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Persist presenter notes across sessions
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, scriptText);
    } catch {
      // ignore storage quota errors
    }
  }, [scriptText]);

  // Keep synced with props when embedded (browser fallback mode)
  useEffect(() => {
    if (standalone) return;
    setLiveRecording(propIsRecording);
    setLivePaused(propIsPaused);
  }, [propIsPaused, propIsRecording, standalone]);

  // Listen to Tauri recording status events when running in standalone overlay window
  useEffect(() => {
    if (!standalone || !isTauriApp()) return;

    // Enforce capture exclusion from inside the standalone window as well
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

  // Auto-start scrolling when recording begins, pause when paused, stop when recording stops
  useEffect(() => {
    if (liveRecording && !livePaused) {
      setIsScrolling(true);
    } else {
      setIsScrolling(false);
    }
  }, [livePaused, liveRecording]);

  // Smooth requestAnimationFrame scroll loop
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
    ? "flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100 select-none"
    : "fixed bottom-6 right-6 z-50 flex h-[380px] w-[360px] flex-col overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-950 text-zinc-100 shadow-2xl select-none";

  return (
    <div className={containerClass} style={{ opacity: opacity / 100 }}>
      {/* Header / Drag Handle */}
      <div
        data-tauri-drag-region={standalone ? "" : undefined}
        className="flex cursor-move items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-3.5 py-2.5"
      >
        <div
          data-tauri-drag-region={standalone ? "" : undefined}
          className="flex items-center gap-2 min-w-0"
        >
          <FileTextIcon className="h-4 w-4 shrink-0 text-indigo-400" />
          <span className="truncate text-xs font-semibold text-zinc-100">
            Presenter Teleprompter
          </span>
          <span
            title="Excluded from Windows screen capture (WDA_EXCLUDEFROMCAPTURE)"
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400"
          >
            <EyeOffIcon className="h-2.5 w-2.5" />
            Hidden in MP4
          </span>
          {liveRecording && (
            <span
              className={`h-2 w-2 rounded-full ${
                livePaused ? "bg-amber-400" : "bg-red-500 rf-recording-dot"
              }`}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleClose()}
          title="Close teleprompter"
          className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-900/60 px-3 py-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsScrolling((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold transition-colors ${
              isScrolling
                ? "bg-indigo-500 text-white"
                : "border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            }`}
          >
            {isScrolling ? <PauseIcon className="h-3 w-3" /> : <PlayIcon className="h-3 w-3" />}
            <span>{isScrolling ? "Pause" : "Scroll"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
            }}
            title="Rewind to top"
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 transition-colors hover:text-white"
          >
            <RotateCcwIcon className="h-3 w-3" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-zinc-400">
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

          <label className="flex items-center gap-1.5 text-zinc-400">
            <span>Opacity</span>
            <input
              type="range"
              min="45"
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
              className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-200 hover:bg-zinc-700"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.min(28, s + 2))}
              className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-200 hover:bg-zinc-700"
            >
              A+
            </button>
          </div>
        </div>
      </div>

      {/* Script Area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 custom-scrollbar"
      >
        <textarea
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder="Type or paste your presenter notes here..."
          rows={14}
          className="h-full min-h-[260px] w-full resize-none bg-transparent leading-relaxed text-zinc-100 placeholder-zinc-600 focus:outline-none select-text"
          style={{ fontSize: `${fontSize}px` }}
        />
      </div>
    </div>
  );
}
