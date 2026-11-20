import { useEffect, useState } from "react";
import { DEFAULT_HOTKEYS, isTauriApp, tauriService } from "../services/tauri.service";
import type { HotkeyApplyFailure, HotkeyConfig } from "../types";
import { CheckIcon, GlobeIcon, KeyboardIcon, RotateCcwIcon, XIcon } from "./Icons";
import { ToggleSwitch } from "./SectionWrapper";

type Props = {
  isOpen: boolean;
  hotkeys: HotkeyConfig;
  onSaved: (next: HotkeyConfig) => void;
  onClose: () => void;
};

type HotkeyActionKey = keyof HotkeyConfig;

const HOTKEY_ENTRIES: { key: HotkeyActionKey; label: string; desc: string }[] = [
  {
    key: "toggle_recording",
    label: "Start / Stop Recording",
    desc: "Begins a new capture or finalizes the active recording",
  },
  {
    key: "toggle_pause",
    label: "Pause / Resume Recording",
    desc: "Pauses or resumes an active recording session",
  },
];

function formatAccelerator(accel: string): string {
  return accel.replace(/^(CmdOrCtrl|CommandOrControl)/i, "Ctrl");
}

function isBareKey(accel: string): boolean {
  const trimmed = accel.trim();
  if (!trimmed) return false;
  return !/(ctrl|cmd|alt|shift|super|meta|option)/i.test(trimmed);
}

export function HotkeyModal({ isOpen, hotkeys, onSaved, onClose }: Props) {
  const [capturing, setCapturing] = useState<HotkeyActionKey | null>(null);
  const [draft, setDraft] = useState<HotkeyConfig>({ ...DEFAULT_HOTKEYS, ...hotkeys });
  const [closeToTray, setCloseToTray] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<HotkeyApplyFailure[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraft({ ...DEFAULT_HOTKEYS, ...hotkeys });
    setFailures([]);
    setError(null);
    setCapturing(null);

    void tauriService
      .getCloseToTray()
      .then(setCloseToTray)
      .catch(() => {});
  }, [hotkeys, isOpen]);

  useEffect(() => {
    if (!isOpen || !capturing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");

      const keyMap: Record<string, string> = {
        " ": "Space",
        ArrowUp: "Up",
        ArrowDown: "Down",
        ArrowLeft: "Left",
        ArrowRight: "Right",
        Escape: "Escape",
      };

      const keyName =
        keyMap[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);

      if (keyName === "Escape" && parts.length === 0) {
        setCapturing(null);
        return;
      }

      parts.push(keyName);
      const combo = parts.join("+");
      setDraft((prev) => ({ ...prev, [capturing]: combo }));
      setCapturing(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [capturing, isOpen]);

  if (!isOpen) return null;

  const handleToggleCloseToTray = async (next: boolean) => {
    setCloseToTray(next);
    try {
      await tauriService.setCloseToTray(next);
    } catch (e) {
      setCloseToTray(!next);
      setError(String(e));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setFailures([]);
    try {
      const result = await tauriService.setHotkeys(draft);
      onSaved(result.hotkeys);
      if (result.failed.length > 0) {
        setFailures(result.failed);
      } else {
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-zinc-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-800 text-indigo-400">
              <KeyboardIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Shortcuts &amp; System Tray</h3>
              <p className="text-xs text-zinc-400">Click any shortcut, then press your new keys</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Global Shortcut Bindings */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <GlobeIcon className="h-3.5 w-3.5 text-indigo-400" />
              Global System Hotkeys
            </span>
            <button
              type="button"
              onClick={() => setDraft({ ...DEFAULT_HOTKEYS })}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              <RotateCcwIcon className="h-3 w-3" />
              Reset defaults
            </button>
          </div>

          {HOTKEY_ENTRIES.map((item) => {
            const isBinding = capturing === item.key;
            const value = draft[item.key] || "";
            const bare = isBareKey(value);

            return (
              <div key={item.key} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setCapturing(isBinding ? null : item.key)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                    isBinding
                      ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                      : "border-zinc-800 bg-zinc-950/70 hover:border-zinc-700"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-100">{item.label}</div>
                    <div className="text-[11px] text-zinc-500">{item.desc}</div>
                  </div>
                  <kbd
                    className={`shrink-0 rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold ${
                      isBinding
                        ? "animate-pulse border-indigo-400 bg-indigo-500 text-white"
                        : "border-zinc-700 bg-zinc-900 text-indigo-300"
                    }`}
                  >
                    {isBinding ? "Press keys..." : formatAccelerator(value)}
                  </kbd>
                </button>
                {bare && !isBinding && (
                  <p className="px-1 text-[11px] text-amber-400">
                    Warning: binding {formatAccelerator(value)} without Ctrl, Alt, or Shift will
                    intercept that key in every application while RecordFlow runs.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Tray Behavior */}
        <div className="mt-5 border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3">
            <div>
              <div className="text-xs font-semibold text-zinc-100">
                Keep running in system tray when closed
              </div>
              <div className="text-[11px] text-zinc-500">
                {isTauriApp()
                  ? "Global shortcuts stay active in the background. Quit from the tray icon."
                  : "Available in the Windows desktop app."}
              </div>
            </div>
            <ToggleSwitch
              checked={closeToTray}
              onChange={(v) => void handleToggleCloseToTray(v)}
              label="Keep running in system tray when closed"
            />
          </div>
        </div>

        {/* Registration Errors */}
        {failures.length > 0 && (
          <div className="mt-4 space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <div className="font-semibold">Some shortcuts could not be registered:</div>
            {failures.map((f) => (
              <div key={`${f.action}-${f.accelerator}`} className="text-[11px] text-amber-300/90">
                • {f.accelerator}: {f.reason}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/70 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-500 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition-colors hover:bg-indigo-400 disabled:opacity-50"
          >
            <CheckIcon className="h-3.5 w-3.5" />
            <span>{saving ? "Applying..." : "Save Shortcuts"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
