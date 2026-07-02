import type { TimerSession, RecordingInfo } from "../types";
import { tauriService } from "../services/tauri.service";

interface SidebarProps {
  isRecording: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  lastRecording: RecordingInfo | null;
  history: TimerSession[];
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  loading: boolean;
  error: string | null;
  canStart: boolean;
  onClearHistory: () => Promise<void>;
  onRemoveSession: (id: string) => Promise<void>;
  historyLoading: boolean;
  historyError: string | null;
  fileError: string | null;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function Sidebar({
  isRecording,
  isPaused,
  elapsedSeconds,
  lastRecording,
  history,
  onStart,
  onStop,
  onPause,
  onResume,
  loading,
  error,
  canStart,
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
    <div className="w-80 bg-white border-r border-gray-200 p-8 flex flex-col shadow-sm shrink-0 h-screen">
      <div className="mb-8 flex items-center gap-3">
        <img
          src="/recordflow.png"
          alt="RecordFlow"
          className="h-14 w-14 rounded-2xl object-cover shadow-sm"
        />
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">RecordFlow</h1>
          <p className="text-sm text-gray-500 mt-1">Screen + Camera recording (Windows)</p>
        </div>
      </div>

      <div className="flex flex-col items-center mb-10">
        <div className="text-6xl font-normal text-gray-800 mb-4 tabular-nums font-mono">
          {formatTime(isRecording ? elapsedSeconds : 0)}
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${
            status === 'recording' 
              ? 'bg-red-500 animate-pulse' 
              : status === 'paused'
                ? 'bg-yellow-500'
                : 'bg-green-500'
          }`}></div>
          <span className="text-sm font-medium text-gray-600 capitalize">{status}</span>
        </div>
      </div>

      <div className="space-y-3 mb-10">
        <button 
          onClick={() => void onStart()}
          disabled={startDisabled}
          className={`w-full py-3 px-6 rounded-md font-bold text-white transition-all ${
            startDisabled 
              ? 'bg-gray-300 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-700 shadow-md'
          }`}
        >
          START
        </button>
        
        {isRecording && !isPaused && (
          <button 
            onClick={() => void onPause()}
            disabled={pauseDisabled}
            className={`w-full py-3 px-6 rounded-md font-bold text-white transition-all ${
              pauseDisabled 
                ? 'bg-yellow-300 cursor-not-allowed' 
                : 'bg-yellow-500 hover:bg-yellow-600 shadow-md'
            }`}
          >
            PAUSE
          </button>
        )}
        
        {isRecording && isPaused && (
          <button 
            onClick={() => void onResume()}
            disabled={resumeDisabled}
            className={`w-full py-3 px-6 rounded-md font-bold text-white transition-all ${
              resumeDisabled 
                ? 'bg-green-300 cursor-not-allowed' 
                : 'bg-green-500 hover:bg-green-600 shadow-md'
            }`}
          >
            RESUME
          </button>
        )}
        
        <button 
          onClick={() => void onStop()}
          disabled={stopDisabled}
          className={`w-full py-3 px-6 rounded-md font-bold text-white transition-all ${
            stopDisabled 
              ? 'bg-red-300 cursor-not-allowed' 
              : 'bg-red-500 hover:bg-red-600 shadow-md'
          }`}
        >
          STOP
        </button>
        
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        <section className="mb-8">
          <h3 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wider">Last Recording</h3>
          {lastRecording ? (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <p className="text-xs font-semibold text-gray-600 truncate">{lastRecording.file_name}</p>
              <p className="text-xs text-gray-500 mt-1">
                {Math.round((lastRecording.file_size / (1024 * 1024)) * 10) / 10} MB
              </p>
              <p className="text-xs text-gray-400 mt-1">{lastRecording.created_at}</p>
              <div className="mt-2 flex gap-2">
                <button 
                  onClick={() => void tauriService.openRecordingInExplorer(lastRecording.file_path)}
                  className="text-xs text-blue-600 font-bold hover:underline"
                >
                  Open in Explorer
                </button>
                <button 
                  onClick={() => void tauriService.openRecordingsFolder()}
                  className="text-xs text-blue-600 font-bold hover:underline"
                >
                  Open Folder
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No recording yet.</p>
          )}
          {fileError && <div className="text-sm text-red-600 mt-2">{fileError}</div>}
        </section>

        <section>
          <h3 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wider">History</h3>
          {history.length > 0 ? (
            <div className="space-y-2">
              {history.slice(0, 10).map(session => (
                <div key={session.id} className="p-2 bg-gray-50 rounded border border-gray-100 flex justify-between items-center group">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-gray-500 truncate block">{session.started_at}</span>
                    <span className="text-xs text-gray-400">{formatTime(session.duration_seconds)}</span>
                  </div>
                  <button
                    onClick={() => void onRemoveSession(session.id)}
                    disabled={historyLoading}
                    className="text-xs text-gray-400 hover:text-red-500 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Remove
                  </button>
                </div>
              ))}
              
              <button
                onClick={() => void onClearHistory()}
                disabled={historyLoading}
                className="w-full mt-2 py-2 px-4 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Clear history
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No sessions yet.</p>
          )}
          {historyError && <div className="text-sm text-red-600 mt-2">{historyError}</div>}
        </section>
      </div>
    </div>
  );
}
