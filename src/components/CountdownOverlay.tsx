import { useEffect } from "react";

type Props = {
  count: number;
  onCancel: () => void;
};

export function CountdownOverlay({ count, onCancel }: Props) {
  useEffect(() => {
    if (count <= 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [count, onCancel]);

  if (count <= 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-md select-none"
      style={{ background: "var(--scrim)" }}
    >
      <div
        className="flex flex-col items-center gap-5 rounded-3xl px-14 py-10"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <span className="h-2 w-2 rounded-full rf-rec-dot" style={{ background: "var(--record)" }} />
          Starting Capture
        </div>

        <div
          key={count}
          className="rf-countdown-num font-mono text-8xl font-bold leading-none tabular-nums"
          style={{ color: "var(--text)" }}
        >
          {count}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-5 py-2 text-xs font-semibold transition-colors"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-2)",
          }}
        >
          Cancel (Esc)
        </button>
      </div>
    </div>
  );
}
