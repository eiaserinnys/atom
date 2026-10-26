import cors from "@fastify/cors";
import Fastify from "fastify";
import { createPageAccessCorsOptions } from "../../src/api/page_access.js";

const SEARCH_MOTION_PAGE_URL = "https://pages.example/d/atom-search-motion";
const PAGES_ORIGIN = new URL(SEARCH_MOTION_PAGE_URL).origin;
const DASHBOARD_ORIGIN = "https://dashboard.example";
const savedEnv = { ...process.env };

async function makeApp(
  frontendUrl?: string,
  searchMotionPageUrl: string | null = SEARCH_MOTION_PAGE_URL,
) {
  if (searchMotionPageUrl) process.env["SEARCH_MOTION_PAGE_URL"] = searchMotionPageUrl;
  else delete process.env["SEARCH_MOTION_PAGE_URL"];
  const app = Fastify({ logger: false });
  await app.register(cors, createPageAccessCorsOptions(frontendUrl));
  app.get("/api/auth/providers", async () => ({ google: true, slack: false }));
  app.get("/api/auth/status", async () => ({ authenticated: true }));
  app.get("/search", async () => []);
  app.get("/cards/:id", async (request) => ({ id: (request.params as { id: string }).id }));
  app.get("/private", async () => ({ ok: true }));
  app.get("/api/auth/google", async () => ({ ok: true }));
  app.post("/cards/:id", async () => ({ ok: true }));
  return app;
}

describe("Pages read-only CORS boundary", () => {
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("allows Pages credentials for the four exact GET/HEAD read paths", async () => {
    const app = await makeApp(DASHBOARD_ORIGIN);
    const urls = [
      "/api/auth/providers",
      "/api/auth/status",
      "/search?q=needle",
      "/cards/card-123",
    ];

    for (const url of urls) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { origin: PAGES_ORIGIN },
      });

      expect(response.headers["access-control-allow-origin"]).toBe(PAGES_ORIGIN);
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
    }

    const head = await app.inject({
      method: "HEAD",
      url: "/cards/card-123",
      headers: { origin: PAGES_ORIGIN },
    });
    expect(head.headers["access-control-allow-origin"]).toBe(PAGES_ORIGIN);
    await app.close();
  });

  it("allows only GET/HEAD preflights on the Pages read paths", async () => {
    const app = await makeApp(DASHBOARD_ORIGIN);
    const allowed = await app.inject({
      method: "OPTIONS",
      url: "/search?q=needle",
      headers: {
        origin: PAGES_ORIGIN,
        "access-control-request-method": "GET",
      },
    });
    const deniedMethod = await app.inject({
      method: "OPTIONS",
      url: "/cards/card-123",
      headers: {
        origin: PAGES_ORIGIN,
        "access-control-request-method": "POST",
      },
    });
    const deniedPath = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/logout",
      headers: {
        origin: PAGES_ORIGIN,
        "access-control-request-method": "GET",
      },
    });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(PAGES_ORIGIN);
    expect(
      allowed.headers["access-control-allow-methods"]
        ?.split(",")
        .map((method) => method.trim()),
    ).toEqual(["GET", "HEAD"]);
    expect(deniedMethod.headers["access-control-allow-origin"]).toBeUndefined();
    expect(deniedPath.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("does not grant Pages CORS to other paths or write methods", async () => {
    const app = await makeApp(DASHBOARD_ORIGIN);
    const requests = [
      { method: "GET" as const, url: "/api/auth/google" },
      { method: "GET" as const, url: "/cards/card-123/extra" },
      { method: "POST" as const, url: "/cards/card-123" },
    ];

    for (const request of requests) {
      const response = await app.inject({
        ...request,
        headers: { origin: PAGES_ORIGIN },
      });
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
    await app.close();
  });

  it("preserves the configured dashboard CORS methods", async () => {
    const app = await makeApp(DASHBOARD_ORIGIN);
    const response = await app.inject({
      method: "OPTIONS",
      url: "/cards/card-123",
      headers: {
        origin: DASHBOARD_ORIGIN,
        "access-control-request-method": "PUT",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(DASHBOARD_ORIGIN);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
    expect(response.headers["access-control-allow-methods"]).toContain("DELETE");
    await app.close();
  });

  it("rejects an unconfigured origin when FRONTEND_URL is set", async () => {
    const app = await makeApp(DASHBOARD_ORIGIN);
    const response = await app.inject({
      method: "GET",
      url: "/private",
      headers: { origin: "https://other.example" },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("allows loopback origins only when FRONTEND_URL is unset", async () => {
    const app = await makeApp(undefined, null);
    const allowed = await app.inject({
      method: "GET",
      url: "/private",
      headers: { origin: "http://localhost:15173" },
    });
    const denied = await app.inject({
      method: "GET",
      url: "/private",
      headers: { origin: "https://other.example" },
    });
    const pagesWritePreflight = await app.inject({
      method: "OPTIONS",
      url: "/search",
      headers: {
        origin: PAGES_ORIGIN,
        "access-control-request-method": "POST",
      },
    });

    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:15173");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    expect(pagesWritePreflight.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("allows the three configured loopback host forms with explicit ports", async () => {
    const app = await makeApp(undefined, null);

    for (const origin of [
      "http://localhost:15173",
      "http://127.0.0.1:14200",
      "http://[::1]:4200",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/private",
        headers: { origin },
      });
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
    }
    await app.close();
  });

  it("disables the search-motion CORS exception when its page URL is unset", async () => {
    const app = await makeApp(undefined, null);
    const response = await app.inject({
      method: "GET",
      url: "/search",
      headers: { origin: PAGES_ORIGIN },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});
