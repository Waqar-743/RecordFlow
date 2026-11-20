import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
};

export function SectionWrapper({ title, subtitle, icon, headerRight, children }: Props) {
  return (
    <section className="rounded-2xl border border-zinc-800/90 bg-zinc-900/75 p-5 shadow-lg shadow-black/20 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-700/70 bg-zinc-800/80 text-indigo-400">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">{title}</h2>
            {subtitle && <p className="text-xs text-zinc-400 truncate">{subtitle}</p>}
          </div>
        </div>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>
      {children}
    </section>
  );
}

type ToggleSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
};

export function ToggleSwitch({ checked, onChange, disabled = false, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-indigo-500" : "bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}
