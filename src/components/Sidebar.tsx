import { tauriService } from "../services/tauri.service";
import type { HotkeyConfig, RecordingInfo, TimerSession } from "../types";
import { FolderIcon, PauseIcon, PlayIcon, StopIcon, TimerIcon, TrashIcon } from "./Icons";
import { ToggleSwitch } from "./SectionWrapper";

interface SidebarProps {
  isRecording: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  lastRecording: RecordingInfo | null;
  history: TimerSession[];
  summaryChips: string[];
  hotkeys: HotkeyConfig;
  countdownSeconds: number;
  onCountdownChange: (sec: number) => void;
  autoMinimize: boolean;
  onAutoMinimizeChange: (enabled: boolean) => void;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  loading: boolean;
  error: string | null;
  canStart: boolean;
  startHint?: string | null;
  onClearHistory: () => Promise<void>;
  onRemoveSession: (id: string) => Promise<void>;
  historyLoading: boolean;
  historyError: string | null;
  fileError: string | null;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Sidebar({
  isRecording,
  isPaused,
  elapsedSeconds,
  lastRecording,
  history,
  summaryChips,
  hotkeys,
  countdownSeconds,
  onCountdownChange,
  autoMinimize,
  onAutoMinimizeChange,
  onStart,
  onStop,
  onPause,
  onResume,
  loading,
  error,
  canStart,
  startHint,
  onClearHistory,
  onRemoveSession,
  historyLoading,
  historyError,
  fileError,
}: SidebarProps) {
  const status = isRecording ? (isPaused ? "paused" : "recording") : "ready";
  const startDisabled = loading || isRecording || !canStart;
  const stopDisabled = loading || !isRecording;
  const pauseDisabled = loading || !isRecording || isPaused;
  const resumeDisabled = loading || !isRecording || !isPaused;

  return (
    <aside className="flex h-screen w-80 shrink-0 flex-col border-r border-zinc-800/90 bg-zinc-950/95 px-5 py-5">
      {/* Brand Header */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/recordflow.png"
            alt="RecordFlow"
            className="h-9 w-9 rounded-xl border border-zinc-800 object-cover shadow-md"
          />
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-white">RecordFlow</h1>
            <p className="text-[11px] text-zinc-500">Zero-latency local capture</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${
            status === "recording"
              ? "border-red-500/40 bg-red-500/15 text-red-400"
              : status === "paused"
                ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "recording"
                ? "bg-red-500 rf-recording-dot"
                : status === "paused"
                  ? "bg-amber-400"
                  : "bg-emerald-400"
            }`}
          />
          {status}
        </span>
      </div>

      {/* Timer & Controls Card */}
      <div
        className={`mb-4 rounded-2xl border p-4 transition-all ${
          status === "recording"
            ? "border-red-500/35 bg-gradient-to-b from-red-950/30 to-zinc-900/90 shadow-lg shadow-red-950/20"
            : "border-zinc-800 bg-zinc-900/75"
        }`}
      >
        <div className="mb-3.5 text-center">
          <div className="font-mono text-4xl font-semibold tracking-tight text-white tabular-nums">
            {formatTime(isRecording ? elapsedSeconds : 0)}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            {summaryChips.map((chip) => (
              <span
                key={chip}
                className="rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-0.5 text-[10px] font-medium text-zinc-400"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        {/* Pre-recording Countdown & Auto-Minimize */}
        <div className="mb-3.5 space-y-2 border-y border-zinc-800/80 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
              <TimerIcon className="h-3.5 w-3.5 text-zinc-500" />
              Countdown
            </span>
            <div className="grid grid-cols-3 gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
              {[0, 3, 5].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  disabled={isRecording}
                  onClick={() => onCountdownChange(sec)}
                  className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
                    countdownSeconds === sec
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {sec === 0 ? "Off" : `${sec}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-zinc-400">Minimize while recording</span>
            <ToggleSwitch
              checked={autoMinimize}
              onChange={onAutoMinimizeChange}
              disabled={isRecording}
              label="Minimize while recording"
            />
          </div>
        </div>

        <div className="space-y-2">
          {!isRecording ? (
            <button
              type="button"
              onClick={() => void onStart()}
              disabled={startDisabled}
              className={`flex h-11 w-full items-center justify-between rounded-xl px-4 text-sm font-semibold transition-all ${
                startDisabled
                  ? "cursor-not-allowed bg-zinc-800 text-zinc-500"
                  : "bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-400 active:scale-[0.99]"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span className="h-3 w-3 rounded-full bg-red-400 ring-2 ring-white/40" />
                <span>{loading ? "Starting..." : "Start Recording"}</span>
              </span>
              {hotkeys.toggle_recording && (
                <kbd className="rounded-md border border-white/20 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white/90">
                  {hotkeys.toggle_recording}
                </kbd>
              )}
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {!isPaused ? (
                <button
                  type="button"
                  onClick={() => void onPause()}
                  disabled={pauseDisabled}
                  title={`Pause (${hotkeys.toggle_pause})`}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/25 disabled:opacity-40"
                >
                  <PauseIcon className="h-3.5 w-3.5" />
                  <span>Pause</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onResume()}
                  disabled={resumeDisabled}
                  title={`Resume (${hotkeys.toggle_pause})`}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  <PlayIcon className="h-3.5 w-3.5" />
                  <span>Resume</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => void onStop()}
                disabled={stopDisabled}
                title={`Stop (${hotkeys.toggle_recording})`}
                className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-red-500 text-xs font-semibold text-white shadow-md shadow-red-500/25 transition-colors hover:bg-red-400 disabled:opacity-40"
              >
                <StopIcon className="h-3.5 w-3.5" />
                <span>Stop</span>
              </button>
            </div>
          )}

          {startHint && !isRecording && !error && (
            <p className="text-center text-[11px] text-amber-300/90">{startHint}</p>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Recordings & History */}
      <div className="flex-1 space-y-5 overflow-y-auto pr-1 custom-scrollbar">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Last Recording
            </h3>
            <button
              type="button"
              onClick={() => void tauriService.openRecordingsFolder()}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300"
            >
              <FolderIcon className="h-3 w-3" />
              <span>Folder</span>
            </button>
          </div>

          {lastRecording ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
              <p
                className="truncate text-xs font-semibold text-zinc-100"
                title={lastRecording.file_name}
              >
                {lastRecording.file_name}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
                <span className="font-mono">{formatFileSize(lastRecording.file_size)}</span>
                <span>·</span>
                <span>{formatTimestamp(lastRecording.created_at)}</span>
              </div>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => void tauriService.openRecordingInExplorer(lastRecording.file_path)}
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/80 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
                >
                  Show in Explorer
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-3 py-3.5 text-center text-xs text-zinc-500">
              Your finished MP4 will appear here.
            </div>
          )}
          {fileError && <div className="mt-2 text-xs text-red-400">{fileError}</div>}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Recent Sessions
            </h3>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => void onClearHistory()}
                disabled={historyLoading}
                className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-40"
              >
                Clear
              </button>
            )}
          </div>

          {history.length > 0 ? (
            <div className="space-y-1.5">
              {history.slice(0, 10).map((session) => (
                <div
                  key={session.id}
                  className="group flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-3 py-2 transition-colors hover:border-zinc-700"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-zinc-200">
                      {formatTimestamp(session.started_at)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="font-mono">{formatTime(session.duration_seconds)}</span>
                      {session.status === "failed" && (
                        <span className="text-red-400">Failed</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onRemoveSession(session.id)}
                    disabled={historyLoading}
                    title="Remove entry"
                    className="ml-2 rounded-md p-1 text-zinc-500 opacity-0 transition-all hover:bg-zinc-800 hover:text-red-400 group-hover:opacity-100"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-600">No recorded sessions yet.</p>
          )}
          {historyError && <div className="mt-2 text-xs text-red-400">{historyError}</div>}
        </div>
      </div>
    </aside>
  );
}
