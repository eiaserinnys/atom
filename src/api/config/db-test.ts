export function mapPostgresConnectionError(err: unknown): string {
  const pgErr = err as { code?: string; message?: string };
  if (pgErr.code === "ECONNREFUSED" || pgErr.message?.includes("ECONNREFUSED")) {
    return "Connection refused: check host and port";
  }
  if (pgErr.code === "28P01") {
    return "Authentication failed: check username/password";
  }
  if (pgErr.code === "3D000") {
    return "Database does not exist";
  }
  return pgErr.message ?? String(err);
}
