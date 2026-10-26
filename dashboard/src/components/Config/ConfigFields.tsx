import { useId, type ReactNode } from "react";

export const CONFIG_CONTROL_CLASS = "px-3 py-1.5 text-sm rounded-none border border-border bg-background text-foreground";

interface ConfigFieldProps {
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}
export function ConfigField({ label, type = "text", placeholder = "", value, disabled, onChange }: ConfigFieldProps) {
  const id = useId();
  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-[13px] text-muted-foreground mb-1">{label}</label>
      <input
        id={id}
        type={type}
        className={`w-full ${CONFIG_CONTROL_CLASS}`}
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
  tone?: "brand" | "danger" | "secondary";
  title?: string;
  onClick: () => void;
}

export function ConfigActionButton({ children, disabled, tone = "brand", title, onClick }: ConfigActionButtonProps) {
  const color = tone === "brand"
    ? "bg-brand text-primary-foreground"
    : tone === "danger"
      ? "bg-node-error text-primary-foreground"
      : "outline outline-1 -outline-offset-1 outline-border bg-transparent text-foreground hover:bg-muted";
  return (
    <button
      className={`px-4 py-2 text-sm font-medium rounded-none ${color} ${tone === "secondary" ? "" : "hover:opacity-90"} disabled:opacity-50`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
