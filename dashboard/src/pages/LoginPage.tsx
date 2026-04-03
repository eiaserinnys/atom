import { useState, useEffect } from 'react';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

interface AuthProviders {
  google: boolean;
  slack: boolean;
}

export function LoginPage() {
  const [providers, setProviders] = useState<AuthProviders | null>(null);

  useEffect(() => {
    fetch(`${BASE_URL}/api/auth/providers`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data: AuthProviders) => setProviders(data))
      .catch(() => setProviders({ google: false, slack: false }));
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-3 px-12 py-10 bg-card border border-border rounded-xl min-w-[280px]">
        <h1 className="m-0 text-2xl font-semibold text-foreground font-sans">atom</h1>
        <p className="m-0 text-sm text-muted-foreground font-sans">지식 관리 시스템</p>

        <div className="flex flex-col gap-2 mt-2 w-full">
          {providers?.slack && (
            <a
              href={`${BASE_URL}/api/auth/slack`}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-input border border-border rounded-lg text-foreground text-sm font-sans no-underline cursor-pointer transition-colors hover:bg-muted"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="currentColor"/>
              </svg>
              Slack으로 로그인
            </a>
          )}

          {providers?.google && (
            <a
              href={`${BASE_URL}/api/auth/google`}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-input border border-border rounded-lg text-foreground text-sm font-sans no-underline cursor-pointer transition-colors hover:bg-muted"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Google로 로그인
            </a>
          )}

          {providers !== null && !providers.google && !providers.slack && (
            <p className="text-sm text-muted-foreground text-center">
              인증이 설정되지 않았습니다
            </p>
          )}

          {providers === null && (
            <div className="flex justify-center py-2">
              <div className="w-5 h-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
