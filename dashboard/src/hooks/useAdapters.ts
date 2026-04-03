import { useState, useEffect } from 'react';
import { api, type AdapterInfo } from '../api/client';

export interface UseAdaptersResult {
  adapters: AdapterInfo[];
  isLoading: boolean;
  error: string | null;
}

export function useAdapters(): UseAdaptersResult {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAdapters()
      .then((res) => {
        setAdapters(res.adapters);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message ?? 'Failed to load adapters');
        setIsLoading(false);
      });
  }, []);

  return { adapters, isLoading, error };
}
