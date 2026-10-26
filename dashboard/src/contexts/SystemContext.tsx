import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { systemApi } from '../api/client';
import { SystemContext } from './systemContext';

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
  }, []);

  useEffect(() => {
    if (!reconnecting) return;
    let active = true;
    let poll: ReturnType<typeof setInterval> | undefined;
    const fail = () => {
      if (!active) return;
      setReconnecting(false);
      setPendingRestart(true);
    };
    // The deadline also applies while the old process keeps returning HTTP 200.
    const deadline = setTimeout(fail, 30_000);
    async function restart() {
      try {
        const previous = await systemApi.getHealth();
        if (!active) return;
        await systemApi.restart();
        if (!active) return;
        poll = setInterval(() => {
          systemApi.getHealth().then(health => {
            if (active && health.bootId && health.bootId !== previous.bootId) {
              active = false;
              clearInterval(poll);
              clearTimeout(deadline);
              window.location.reload();
            }
          }).catch(() => {}); // Expected while the process is down.
        }, 1000);
      } catch {
        fail();
      }
    }
    void restart();
    return () => {
      active = false;
      clearInterval(poll);
      clearTimeout(deadline);
    };
  }, [reconnecting]);

  const refreshStatus = useCallback(() => {
    systemApi.getStatus()
      .then((s) => setPendingRestart(s.pendingRestart))
      .catch(() => {});
  }, []);

  return (
    <SystemContext.Provider value={{ pendingRestart, reconnecting, triggerRestart, refreshStatus }}>
      {children}
    </SystemContext.Provider>
  );
}
