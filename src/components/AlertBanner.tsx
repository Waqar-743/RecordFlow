import type { AlertBannerItem } from "../types";
import { AlertTriangleIcon, CheckIcon, SparklesIcon, XIcon } from "./Icons";

type Props = {
  alert: AlertBannerItem | null;
  onDismiss: () => void;
};

export function AlertBanner({ alert, onDismiss }: Props) {
  if (!alert) return null;

  const palette = {
    warning: {
      bg: "var(--warning-soft)",
      border: "var(--warning)",
      accent: "var(--warning)",
      Icon: AlertTriangleIcon,
    },
    error: {
      bg: "var(--danger-soft)",
      border: "var(--danger)",
      accent: "var(--danger)",
      Icon: AlertTriangleIcon,
    },
    success: {
      bg: "var(--success-soft)",
      border: "var(--success)",
      accent: "var(--success)",
      Icon: CheckIcon,
    },
    info: {
      bg: "var(--accent-soft)",
      border: "var(--accent)",
      accent: "var(--accent)",
      Icon: SparklesIcon,
    },
  }[alert.severity];

  const Icon = palette.Icon;

  return (
    <div
      role="status"
      className="rf-pop-in flex shrink-0 items-center justify-between gap-3 px-5 py-2 text-xs"
      style={{
        background: palette.bg,
        borderBottom: `1px solid ${palette.border}`,
        color: "var(--text)",
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0" style={{ color: palette.accent }} />
        <div className="truncate">
          {alert.title && <span className="mr-1.5 font-semibold">{alert.title}:</span>}
          <span style={{ color: "var(--text)" }}>{alert.message}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {alert.actionLabel && alert.onAction && (
          <button
            type="button"
            onClick={alert.onAction}
            className="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-opacity hover:opacity-85"
            style={{
              background: palette.accent,
              color: "#0b0c0e",
            }}
          >
            {alert.actionLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notice"
          className="rounded-md p-1 transition-colors hover:opacity-75"
          style={{ color: "var(--text-2)" }}
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
