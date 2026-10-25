import type { ReactNode } from "react";

interface ConfigFieldProps {
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}
export function ConfigField({ label, type = "text", placeholder = "", value, disabled, onChange }: ConfigFieldProps) {
  return (
    <div className="mb-3">
      <label className="block text-[13px] text-muted-foreground mb-1">{label}</label>
      <input
        type={type}
        className="w-full px-3 py-1.5 text-sm rounded-none border border-border bg-background text-foreground"
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

interface ConfigActionButtonProps {
  children: ReactNode;
  disabled?: boolean;
  tone?: "brand" | "danger";
  onClick: () => void;
}

export function ConfigActionButton({ children, disabled, tone = "brand", onClick }: ConfigActionButtonProps) {
  const color = tone === "brand" ? "bg-brand text-primary-foreground" : "bg-node-error text-primary-foreground";
  return (
    <button
      className={`px-4 py-2 text-sm font-medium rounded-none ${color} hover:opacity-90 disabled:opacity-50`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
