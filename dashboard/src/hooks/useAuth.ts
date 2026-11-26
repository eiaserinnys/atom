import { useState, useEffect } from 'react';
import { api, type UserRole } from '../api/client';
import type { AuthStatus as ServerAuthStatus } from '../api/types';

export type { UserRole };

export const BYPASS_USER_ID = 'bypass';

export interface AuthStatus extends ServerAuthStatus {
  loading: boolean;
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
