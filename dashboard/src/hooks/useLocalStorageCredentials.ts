import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'atom-credentials';
const SYNC_EVENT = 'atom-credentials-sync';

type Credentials = Record<string, Record<string, string>>;

function readFromStorage(): Credentials {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function useLocalStorageCredentials() {
  const [credentials, setCredentials] = useState<Credentials>(readFromStorage);

  // 다른 인스턴스(CredentialsTab 등)가 localStorage를 업데이트하면 동기화
  useEffect(() => {
    const handler = () => setCredentials(readFromStorage());
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const updateCredential = useCallback(
    (sourceType: string, key: string, value: string) => {
      setCredentials(prev => {
        const next: Credentials = {
          ...prev,
          [sourceType]: { ...(prev[sourceType] ?? {}), [key]: value },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        // 같은 탭의 다른 훅 인스턴스에 변경 알림
        window.dispatchEvent(new CustomEvent(SYNC_EVENT));
        return next;
      });
    },
    []
  );

  return { credentials, updateCredential };
}
