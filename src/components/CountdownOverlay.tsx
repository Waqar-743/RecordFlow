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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-md select-none">
      <div className="relative flex h-36 w-36 items-center justify-center rounded-full border-2 border-indigo-500 bg-zinc-900 shadow-2xl shadow-indigo-500/25">
        <span className="font-mono text-7xl font-bold text-white tabular-nums">{count}</span>
      </div>

      <p className="mt-6 text-sm font-medium text-zinc-200">
        Recording starts in {count} {count === 1 ? "second" : "seconds"}...
      </p>

      <button
        type="button"
        onClick={onCancel}
        className="mt-4 rounded-full border border-zinc-700 bg-zinc-900/90 px-4 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
      >
        Cancel <span className="text-zinc-500">(Esc)</span>
      </button>
    </div>
  );
}
