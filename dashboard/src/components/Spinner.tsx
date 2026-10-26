import { Loader2 } from 'lucide-react';

interface SpinnerProps { size?: 'sm' | 'md'; label?: string }

export function Spinner({ size = 'md', label }: SpinnerProps) {
  const icon = <Loader2 className={`${size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5'} animate-spin text-muted-foreground shrink-0`} strokeWidth={1.75} aria-hidden="true" />;
  if (!label) return icon;
  return <span role="status" className="inline-flex">{icon}<span className="sr-only">{label}</span></span>;
}
