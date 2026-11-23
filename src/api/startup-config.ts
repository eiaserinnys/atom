import { getDashboardAdminPassword, resolveAuthMode } from "./auth-mode.js";

export type StartupEnvironment = Record<string, string | undefined>;

export type StartupConfigInspection = {
  errors: string[];
  warning: string | undefined;
};

export function inspectStartupConfig(env: StartupEnvironment): StartupConfigInspection {
  const providerRequirements = [
    {
      clientId: "GOOGLE_CLIENT_ID",
      required: ["GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL"],
    },
    {
      clientId: "SLACK_CLIENT_ID",
      required: ["SLACK_CLIENT_SECRET", "SLACK_CALLBACK_URL"],
    },
  ].filter(({ clientId }) => Boolean(env[clientId]));

  const hasOAuthProvider = providerRequirements.length > 0;
  const bypassConfigured = env["AUTH_BYPASS"] === "1";
  const errors: string[] = [];

  if (hasOAuthProvider && bypassConfigured) {
    errors.push("AUTH_BYPASS=1 cannot be combined with an OAuth provider.");
  }

  const passwordConfigured = Boolean(getDashboardAdminPassword(env));
  if (passwordConfigured && bypassConfigured) {
    errors.push("AUTH_BYPASS=1 cannot be combined with DASHBOARD_ADMIN_PASSWORD.");
  }
  const mode = resolveAuthMode(env);
  if (mode === "password" && !env["JWT_SECRET"]?.trim()) {
    errors.push("Missing required environment variables: JWT_SECRET");
  }

  if (hasOAuthProvider) {
    const required = [
      "JWT_SECRET",
      "FRONTEND_URL",
      ...providerRequirements.flatMap(({ required: providerRequired }) => providerRequired),
    ];
    const missing = required.filter((name) => !env[name]?.trim());
    if (missing.length > 0) {
      errors.push("Missing required environment variables: " + missing.join(", "));
    }
  }

  return {
    errors,
    warning: mode === "unconfigured"
      ? "No login method is configured; browser APIs will return 401. Set AUTH_BYPASS=1 for local development."
      : mode === "oauth" && passwordConfigured
        ? "DASHBOARD_ADMIN_PASSWORD is ignored because an OAuth provider is configured."
        : undefined,
  };
}
