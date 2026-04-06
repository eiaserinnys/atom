import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { systemApi } from '../api/client';

interface SystemState {
  pendingRestart: boolean;
  reconnecting: boolean;
  triggerRestart: () => void;
}

const SystemContext = createContext<SystemState>({
  pendingRestart: false,
  reconnecting: false,
  triggerRestart: () => {},
});

export function useSystem() {
  return useContext(SystemContext);
}

export function SystemProvider({ children }: { children: ReactNode }) {
  const [pendingRestart, setPendingRestart] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // Poll system status every 30s
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      systemApi.getStatus()
        .then((s) => { if (!cancelled) setPendingRestart(s.pendingRestart); })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const triggerRestart = useCallback(() => {
    setReconnecting(true);
    setPendingRestart(false);
    systemApi.restart().catch(() => {});

    // Poll /api/health until server comes back
    const start = Date.now();
    const poll = setInterval(() => {
      systemApi.getHealth()
        .then(() => {
          clearInterval(poll);
          window.location.reload();
        })
        .catch(() => {
          if (Date.now() - start > 30_000) {
            clearInterval(poll);
            setReconnecting(false);
            setPendingRestart(true);
          }
        });
    }, 1000);
  }, []);

  return (
    <SystemContext.Provider value={{ pendingRestart, reconnecting, triggerRestart }}>
      {children}
    </SystemContext.Provider>
  );
}
