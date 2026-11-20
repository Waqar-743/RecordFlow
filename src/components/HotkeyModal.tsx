import { useEffect, useState } from "react";
import { DEFAULT_HOTKEYS, isTauriApp, tauriService } from "../services/tauri.service";
import type { HotkeyApplyFailure, HotkeyConfig } from "../types";
import { CheckIcon, GlobeIcon, KeyboardIcon, RotateCcwIcon, XIcon } from "./Icons";
import { ToggleSwitch } from "./ToggleSwitch";

type Props = {
  isOpen: boolean;
  hotkeys: HotkeyConfig;
  onSaved: (next: HotkeyConfig, failures: HotkeyApplyFailure[]) => void;
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
    if (!isOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capturing) onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [capturing, isOpen, onClose]);

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
      setDraft((prev) => ({ ...prev, [capturing]: parts.join("+") }));
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
      onSaved(result.hotkeys, result.failed);
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm select-none"
      style={{ background: "var(--scrim)" }}
      onClick={onClose}
    >
      <div
        className="rf-pop-in w-full max-w-md rounded-2xl p-5"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          color: "var(--text)",
          boxShadow: "var(--shadow-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent)",
              }}
            >
              <KeyboardIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Shortcuts &amp; System Tray</h3>
              <p className="text-xs" style={{ color: "var(--text-2)" }}>
                Click any shortcut, then press your new key combo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5"
            style={{ color: "var(--text-2)" }}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Global Shortcut Bindings */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-3)" }}
            >
              <GlobeIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
              Global System Hotkeys
            </span>
            <button
              type="button"
              onClick={() => setDraft({ ...DEFAULT_HOTKEYS })}
              className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
              style={{ color: "var(--text-2)" }}
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
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition-all"
                  style={{
                    background: isBinding ? "var(--accent-soft)" : "var(--inset)",
                    border: `1px solid ${isBinding ? "var(--accent)" : "var(--border)"}`,
                  }}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                      {item.label}
                    </div>
                    <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                      {item.desc}
                    </div>
                  </div>
                  <kbd
                    className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-xs font-semibold ${
                      isBinding ? "animate-pulse" : ""
                    }`}
                    style={
                      isBinding
                        ? { background: "var(--accent)", color: "var(--accent-fg)" }
                        : {
                            background: "var(--surface-2)",
                            border: "1px solid var(--border-strong)",
                            color: "var(--accent)",
                          }
                    }
                  >
                    {isBinding ? "Press keys…" : formatAccelerator(value)}
                  </kbd>
                </button>
                {bare && !isBinding && (
                  <p className="px-1 text-[11px]" style={{ color: "var(--warning)" }}>
                    Binding {formatAccelerator(value)} without Ctrl, Alt, or Shift intercepts that key system-wide.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Tray Behavior */}
        <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div
            className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3"
            style={{ background: "var(--inset)", border: "1px solid var(--border)" }}
          >
            <div>
              <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                Keep running in system tray when closed
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
                {isTauriApp()
                  ? "Global shortcuts remain active in the background."
                  : "Available in the desktop application."}
              </div>
            </div>
            <ToggleSwitch
              checked={closeToTray}
              onChange={(v) => void handleToggleCloseToTray(v)}
              label="Keep running in system tray when closed"
            />
          </div>
        </div>

        {failures.length > 0 && (
          <div
            className="mt-4 space-y-1 rounded-xl p-3 text-xs"
            style={{
              background: "var(--warning-soft)",
              border: "1px solid var(--warning)",
              color: "var(--text)",
            }}
          >
            <div className="font-semibold">Some shortcuts could not be registered:</div>
            {failures.map((f) => (
              <div key={`${f.action}-${f.accelerator}`} className="text-[11px]" style={{ color: "var(--text-2)" }}>
                • {f.accelerator}: {f.reason}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div
            className="mt-3 rounded-xl p-2.5 text-xs"
            style={{ background: "var(--danger-soft)", border: "1px solid var(--danger)", color: "var(--danger)" }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl py-2.5 text-xs font-medium"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-2)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold shadow disabled:opacity-50"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            <CheckIcon className="h-3.5 w-3.5" />
            <span>{saving ? "Applying…" : "Save Shortcuts"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
