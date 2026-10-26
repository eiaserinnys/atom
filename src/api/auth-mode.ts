export function isAuthBypassEnabled(): boolean {
  const hasOAuthProvider = Boolean(
    process.env["GOOGLE_CLIENT_ID"] || process.env["SLACK_CLIENT_ID"],
  );
  return !hasOAuthProvider && process.env["AUTH_BYPASS"] === "1";
}
