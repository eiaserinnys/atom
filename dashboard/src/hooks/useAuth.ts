import { useState, useEffect } from 'react';
import { api } from '../api/client';

export interface AuthStatus {
  loading: boolean;
  authenticated: boolean;
  email?: string;
  name?: string;
}

export function useAuth(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>({ loading: true, authenticated: false });

  useEffect(() => {
    api
      .getAuthStatus()
      .then((data) => setStatus({ loading: false, ...data }))
      .catch(() => setStatus({ loading: false, authenticated: false }));
  }, []);

  return status;
}
