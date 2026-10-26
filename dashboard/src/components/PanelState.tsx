import type { ReactNode } from 'react';

export function PanelState({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">{children}</div>;
}
