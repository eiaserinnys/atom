const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-3 px-12 py-10 bg-card border border-border rounded-xl">
        <h1 className="m-0 text-2xl font-semibold text-foreground font-sans">atom</h1>
        <p className="m-0 text-sm text-muted-foreground font-sans">지식 관리 시스템</p>
        <a
          href={`${BASE_URL}/api/auth/google`}
          className="mt-2 px-5 py-2.5 bg-input border border-border rounded-lg text-foreground text-sm font-sans no-underline cursor-pointer transition-colors hover:bg-muted"
        >
          Google로 로그인
        </a>
      </div>
    </div>
  );
}
