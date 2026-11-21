import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { THEMES } from "../theme/themes";
import type { WorkspaceMode } from "../types";
import {
  BrandLogoIcon,
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  FilmIcon,
  FolderOpenIcon,
  KeyboardIcon,
  PaletteIcon,
  RecordDotIcon,
  SaveIcon,
  StopIcon,
} from "./Icons";

type Props = {
  workspace: WorkspaceMode;
  onWorkspaceChange: (mode: WorkspaceMode) => void;
  hasProject: boolean;
  isRecording: boolean;
  isPaused?: boolean;
  elapsedSeconds?: number;
  onStopRecording?: () => void;
  isScriptOpen: boolean;
  onToggleScript: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onOpenShortcuts: () => void;
};

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TopBar({
  workspace,
  onWorkspaceChange,
  hasProject,
  isRecording,
  isPaused = false,
  elapsedSeconds = 0,
  onStopRecording,
  isScriptOpen,
  onToggleScript,
  onOpenProject,
  onSaveProject,
  onOpenShortcuts,
}: Props) {
  const { theme, setTheme } = useTheme();
  const [themeOpen, setThemeOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!themeOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThemeOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [themeOpen]);

  return (
    <header
      className="relative z-30 flex h-14 shrink-0 items-center justify-between gap-4 px-5 select-none"
      style={{
        background: "var(--bg-elev)",
        borderBottom: "1px solid var(--border)",
        boxShadow: "0 1px 0 var(--highlight)",
      }}
    >
      {/* Left: Brand + Workspace Switcher + File Actions */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <BrandLogoIcon className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold tracking-tight" style={{ color: "var(--text)" }}>
              RecordFlow
            </span>
            <span
              className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent)",
                border: "1px solid var(--accent-ring)",
              }}
            >
              Studio
            </span>
          </div>
        </div>

        <div className="h-5 w-px" style={{ background: "var(--border)" }} />

        {/* Primary Record / Edit Workspace Switcher */}
        <nav
          aria-label="Workspace"
          className="inline-flex items-center rounded-xl p-1"
          style={{
            background: "var(--inset)",
            border: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            onClick={() => onWorkspaceChange("record")}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
            style={
              workspace === "record"
                ? {
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    border: "1px solid var(--border-strong)",
                    boxShadow: "var(--shadow-sm)",
                  }
                : { color: "var(--text-2)", border: "1px solid transparent" }
            }
          >
            <RecordDotIcon
              className={`h-3 w-3 ${isRecording ? "rf-rec-dot" : ""}`}
              style={{
                color: isRecording
                  ? "var(--record)"
                  : workspace === "record"
                    ? "var(--accent)"
                    : "var(--text-3)",
              }}
            />
            <span>Record</span>
          </button>

          <button
            type="button"
            onClick={() => onWorkspaceChange("edit")}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all"
            style={
              workspace === "edit"
                ? {
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    border: "1px solid var(--border-strong)",
                    boxShadow: "var(--shadow-sm)",
                  }
                : { color: "var(--text-2)", border: "1px solid transparent" }
            }
          >
            <FilmIcon
              className="h-3.5 w-3.5"
              style={{ color: workspace === "edit" ? "var(--accent)" : "var(--text-3)" }}
            />
            <span>Edit Studio</span>
            {hasProject && workspace === "record" && (
              <span
                className="ml-0.5 h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
                title="Project loaded in Edit Studio"
              />
            )}
          </button>
        </nav>

        {/* Quick Project Actions */}
        <div className="hidden md:flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenProject}
            title="Open a saved RecordFlow project or local video file"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: "var(--surface)",
              color: "var(--text-2)",
              border: "1px solid var(--border)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-2)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--surface)";
              e.currentTarget.style.color = "var(--text-2)";
            }}
          >
            <FolderOpenIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
            <span>Open project</span>
          </button>

          <button
            type="button"
            onClick={onSaveProject}
            disabled={!hasProject}
            title={
              hasProject
                ? "Save current studio project (.rfproj.json)"
                : "Record or open a video to save a project"
            }
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              !hasProject ? "opacity-45 cursor-not-allowed" : ""
            }`}
            style={{
              background: "var(--surface)",
              color: "var(--text-2)",
              border: "1px solid var(--border)",
            }}
            onMouseEnter={(e) => {
              if (!hasProject) return;
              e.currentTarget.style.background = "var(--surface-2)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--surface)";
              e.currentTarget.style.color = "var(--text-2)";
            }}
          >
            <SaveIcon className="h-3.5 w-3.5" />
            <span>Save project</span>
          </button>
        </div>
      </div>

      {/* Right: Live Recording Pill + Theme Selector + Script Toggle + Shortcuts */}
      <div className="flex items-center gap-2">
        {isRecording && (
          <div
            className="inline-flex items-center gap-2 rounded-xl px-2.5 py-1 text-xs font-semibold"
            style={{
              background: "var(--danger-soft)",
              border: "1px solid var(--record)",
              color: "var(--text)",
            }}
          >
            <span
              className={`h-2 w-2 rounded-full ${!isPaused ? "rf-rec-dot" : ""}`}
              style={{ background: isPaused ? "var(--warning)" : "var(--record)" }}
            />
            <span className="font-mono tabular-nums">{formatClock(elapsedSeconds)}</span>
            {onStopRecording && (
              <button
                type="button"
                onClick={onStopRecording}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-white"
                style={{ background: "var(--record)" }}
              >
                <StopIcon className="h-2.5 w-2.5" />
                <span>Stop</span>
              </button>
            )}
          </div>
        )}

        {/* Interactive Theme Selector Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setThemeOpen((v) => !v)}
            aria-expanded={themeOpen}
            aria-haspopup="listbox"
            className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: themeOpen ? "var(--surface-2)" : "var(--surface)",
              border: `1px solid ${themeOpen ? "var(--accent)" : "var(--border)"}`,
              color: "var(--text)",
            }}
          >
            <PaletteIcon className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
            <span className="flex items-center -space-x-1">
              <span
                className="h-3 w-3 rounded-full border border-black/30"
                style={{ background: theme.swatch[0] }}
              />
              <span
                className="h-3 w-3 rounded-full border border-black/30"
                style={{ background: theme.swatch[2] }}
              />
            </span>
            <span>{theme.name}</span>
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform ${themeOpen ? "rotate-180" : ""}`}
              style={{ color: "var(--text-3)" }}
            />
          </button>

          {themeOpen && (
            <div
              role="listbox"
              aria-label="Choose theme"
              className="rf-pop-in absolute right-0 top-full mt-2 w-80 overflow-hidden rounded-2xl p-2"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border-strong)",
                boxShadow: "var(--shadow-lg)",
              }}
            >
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-3)" }}
                >
                  Warm Studio Palettes
                </span>
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {THEMES.length} themes
                </span>
              </div>

              <div className="mt-1 space-y-1 max-h-80 overflow-y-auto rf-scroll">
                {THEMES.map((item) => {
                  const active = item.id === theme.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        setTheme(item.id);
                        setThemeOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors"
                      style={{
                        background: active ? "var(--accent-soft)" : "transparent",
                        border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
                        color: "var(--text)",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.background = "var(--surface-2)";
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {/* Theme mini preview swatch */}
                      <div
                        className="flex h-8 w-12 shrink-0 flex-col justify-between rounded-lg p-1.5 border"
                        style={{
                          background: item.swatch[0],
                          borderColor:
                            item.mode === "light" ? "rgba(60,30,15,0.16)" : "rgba(255,235,220,0.14)",
                        }}
                      >
                        <div className="flex items-center gap-1">
                          <span
                            className="h-1.5 w-4 rounded-full"
                            style={{ background: item.swatch[2] }}
                          />
                          <span
                            className="h-1.5 w-1.5 rounded-full opacity-75"
                            style={{ background: item.swatch[3] }}
                          />
                        </div>
                        <div
                          className="h-2 w-full rounded-sm"
                          style={{ background: item.swatch[1] }}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold">{item.name}</span>
                          <span
                            className="rounded px-1 py-px text-[9px] uppercase tracking-wide"
                            style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
                          >
                            {item.mode}
                          </span>
                        </div>
                        <div className="truncate text-[11px]" style={{ color: "var(--text-2)" }}>
                          {item.description}
                        </div>
                      </div>

                      {active && (
                        <CheckIcon
                          className="h-4 w-4 shrink-0"
                          style={{ color: "var(--accent)" }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Script / Teleprompter Panel Toggle */}
        <button
          type="button"
          onClick={onToggleScript}
          title="Toggle capture-excluded Presenter Script panel"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
          style={
            isScriptOpen
              ? {
                  background: "var(--accent-soft)",
                  border: "1px solid var(--accent)",
                  color: "var(--accent)",
                }
              : {
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text-2)",
                }
          }
        >
          <FileTextIcon className="h-3.5 w-3.5" />
          <span>Script</span>
        </button>

        {/* Shortcuts Config Menu */}
        <button
          type="button"
          onClick={onOpenShortcuts}
          title="Configure global keyboard shortcuts & system tray"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text-2)",
          }}
        >
          <KeyboardIcon className="h-3.5 w-3.5" />
          <span>Shortcuts</span>
        </button>
      </div>
    </header>
  );
}
