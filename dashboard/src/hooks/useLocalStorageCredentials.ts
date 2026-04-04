import { useState, useCallback } from 'react';

const STORAGE_KEY = 'atom-credentials';

type Credentials = Record<string, Record<string, string>>;

export function readStoredCredentials(): Credentials {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function useLocalStorageCredentials() {
  const [credentials, setCredentials] = useState<Credentials>(readStoredCredentials);

  const updateCredential = useCallback(
    (sourceType: string, key: string, value: string) => {
      setCredentials(prev => {
        const next: Credentials = {
          ...prev,
          [sourceType]: { ...(prev[sourceType] ?? {}), [key]: value },
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  return { credentials, updateCredential };
}
