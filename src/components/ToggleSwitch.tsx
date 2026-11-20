type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  size?: "sm" | "md";
};

export function ToggleSwitch({ checked, onChange, disabled = false, label, size = "md" }: Props) {
  const trackW = size === "sm" ? "w-8 h-[18px]" : "w-10 h-[22px]";
  const thumb = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const translate = size === "sm" ? (checked ? "translate-x-[15px]" : "translate-x-[2px]") : checked ? "translate-x-[20px]" : "translate-x-[3px]";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150 ${trackW} ${
        disabled ? "opacity-45 cursor-not-allowed" : "cursor-pointer"
      }`}
      style={{
        background: checked ? "var(--accent)" : "var(--surface-3)",
        border: `1px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
      }}
    >
      <span
        className={`inline-block rounded-full transition-transform duration-150 shadow-sm ${thumb} ${translate}`}
        style={{
          background: checked ? "var(--accent-fg)" : "var(--text)",
        }}
      />
    </button>
  );
}
