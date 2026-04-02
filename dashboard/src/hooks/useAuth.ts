import { useState, useEffect } from 'react';
import { api, type UserRole } from '../api/client';

export type { UserRole };

export interface AuthStatus {
  loading: boolean;
  authenticated: boolean;
  id?: string;
  email?: string;
  name?: string;
  role?: UserRole;
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
