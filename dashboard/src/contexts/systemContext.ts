import { createContext, useContext } from 'react';

export interface SystemState {
  pendingRestart: boolean;
  reconnecting: boolean;
  triggerRestart: () => void;
  refreshStatus: () => void;
}

export const SystemContext = createContext<SystemState>({
  pendingRestart: false,
  reconnecting: false,
  triggerRestart: () => {},
  refreshStatus: () => {},
});

export function useSystem() {
  return useContext(SystemContext);
}
