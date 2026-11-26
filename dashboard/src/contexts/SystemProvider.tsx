import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { systemApi } from '../api/client';
import { SystemContext } from './systemContext';

export function SystemProvider({ children }: { children: ReactNode }) {
  const [pendingRestart, setPendingRestart] = useState(false);
  const [manualRestartRequired, setManualRestartRequired] = useState(false);
  const [restartMode, setRestartMode] = useState<'manual' | 'automatic' | null>(null);
  const reconnecting = restartMode !== null;

  // Poll system status every 30s
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      systemApi.getStatus()
        .then((s) => {
          if (cancelled) return;
          setPendingRestart(s.pendingRestart);
          setManualRestartRequired(s.manualRestartRequired);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const triggerRestart = useCallback(() => {
    setRestartMode(manualRestartRequired ? 'manual' : 'automatic');
    setPendingRestart(false);
  }, [manualRestartRequired]);

  useEffect(() => {
    if (restartMode === null) return;
    let active = true;
    let poll: ReturnType<typeof setInterval> | undefined;
    const fail = () => {
      if (!active) return;
      setRestartMode(null);
      setPendingRestart(true);
    };
    // The deadline also applies while the old process keeps returning HTTP 200.
    // A manual start has no deadline: the server stays down until the user starts it.
    const deadline = restartMode === 'manual' ? undefined : setTimeout(fail, 30_000);
    async function restart() {
      let previousBootId: string | undefined;
      try {
        previousBootId = (await systemApi.getHealth()).bootId;
      } catch {
        // The server may still be down after an earlier restart attempt.
      }
      if (!active) return;
      if (previousBootId !== undefined) {
        try {
          await systemApi.restart();
        } catch {
          fail();
          return;
        }
      }
      if (!active) return;
      poll = setInterval(() => {
        systemApi.getHealth().then(health => {
          if (active && (previousBootId === undefined || (health.bootId && health.bootId !== previousBootId))) {
            active = false;
            clearInterval(poll);
            clearTimeout(deadline);
            window.location.reload();
          }
        }).catch(() => {}); // Expected while the process is down.
      }, 1000);
    }
    void restart();
    return () => {
      active = false;
      clearInterval(poll);
      clearTimeout(deadline);
    };
  }, [restartMode]);

  const refreshStatus = useCallback(() => {
    systemApi.getStatus()
      .then((s) => {
        setPendingRestart(s.pendingRestart);
        setManualRestartRequired(s.manualRestartRequired);
      })
      .catch(() => {});
  }, []);

  return (
    <SystemContext.Provider value={{ pendingRestart, manualRestartRequired, reconnecting, triggerRestart, refreshStatus }}>
      {children}
    </SystemContext.Provider>
  );
}
