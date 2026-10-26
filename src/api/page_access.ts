import type { FastifyCorsOptions } from "@fastify/cors";
import type { FastifyRequest } from "fastify";

const PAGE_READ_PATHS = new Set([
  "/api/auth/providers",
  "/api/auth/status",
  "/search",
]);
const ALL_API_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"];

function isPagesReadRequest(request: FastifyRequest): boolean {
  const method = request.method === "OPTIONS"
    ? request.headers["access-control-request-method"]
    : request.method;
  if (method !== "GET" && method !== "HEAD") return false;

  const pathname = request.url.split("?")[0] ?? request.url;
  return PAGE_READ_PATHS.has(pathname) || /^\/cards\/[^/]+$/.test(pathname);
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === "http:" &&
      parsed.port !== "" &&
      parsed.origin === origin &&
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1");
  } catch {
    return false;
  }
}

export function resolveAllowedCorsOrigin(
  request: FastifyRequest,
  frontendUrl: string | undefined,
  searchMotionPageUrl: string | undefined = process.env["SEARCH_MOTION_PAGE_URL"],
): string | undefined {
  const origin = request.headers.origin;
  if (!origin) return undefined;
  if (origin === frontendUrl) return origin;

  if (searchMotionPageUrl && origin === new URL(searchMotionPageUrl).origin) {
    return isPagesReadRequest(request) ? origin : undefined;
  }
  if (frontendUrl) return undefined;
  return isLoopbackOrigin(origin) ? origin : undefined;
}

export function createPageAccessCorsOptions(frontendUrl: string | undefined): FastifyCorsOptions {
  return {
    delegator: async (request: FastifyRequest) => {
      const searchMotionPageUrl = process.env["SEARCH_MOTION_PAGE_URL"];
      const origin = resolveAllowedCorsOrigin(request, frontendUrl, searchMotionPageUrl);
      if (!origin) return { origin: false };
      const isSearchMotionPage = Boolean(searchMotionPageUrl) &&
        origin !== frontendUrl &&
        origin === new URL(searchMotionPageUrl!).origin;

      return {
        origin,
        credentials: true,
        methods: isSearchMotionPage ? ["GET", "HEAD"] : ALL_API_METHODS,
      };
    },
  };
}
