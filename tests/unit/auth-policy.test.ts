import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { authMiddleware } from "../../src/api/middleware/auth.js";
import { authRoutes } from "../../src/api/routes/auth.js";
import { systemRoutes } from "../../src/api/routes/system.js";

const savedEnv = { ...process.env };

function resetAuthEnvironment() {
  process.env = { ...savedEnv };
  for (const key of [
    "AUTH_BYPASS",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CALLBACK_URL",
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "SLACK_CALLBACK_URL",
    "SEARCH_MOTION_PAGE_URL",
  ]) {
    delete process.env[key];
  }
  process.env["JWT_SECRET"] = "test-auth-policy-secret";
}

async function makeApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authRoutes);
  app.addHook("preHandler", authMiddleware);
  await app.register(systemRoutes);
  app.get("/tree", async () => []);
  return app;
}

describe("browser authentication policy", () => {
  beforeEach(resetAuthEnvironment);
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("returns 401 without a provider or explicit bypass while public health remains available", async () => {
    const app = await makeApp();
    const tree = await app.inject({ method: "GET", url: "/tree" });
    const health = await app.inject({ method: "GET", url: "/api/health" });
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    const providers = await app.inject({ method: "GET", url: "/api/auth/providers" });

    expect(tree.statusCode).toBe(401);
    expect(tree.json()).toEqual({ error: "Unauthorized" });
    expect(health.statusCode).toBe(200);
    expect(status.json()).toEqual({ authenticated: false });
    expect(providers.json()).toEqual({ google: false, slack: false });
    await app.close();
  });

  it("allows the virtual admin only with AUTH_BYPASS=1 and no OAuth provider", async () => {
    process.env["AUTH_BYPASS"] = "1";
    const app = await makeApp();
    const tree = await app.inject({ method: "GET", url: "/tree" });
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });

    expect(tree.statusCode).toBe(200);
    expect(status.json()).toEqual({
      authenticated: true,
      id: "bypass",
      email: "bypass@local",
      name: "Bypass Admin",
      role: "admin",
    });
    await app.close();
  });

  it("does not let bypass override a configured provider", async () => {
    process.env["AUTH_BYPASS"] = "1";
    process.env["GOOGLE_CLIENT_ID"] = "google-client";
    const app = await makeApp();
    const tree = await app.inject({ method: "GET", url: "/tree" });
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });

    expect(tree.statusCode).toBe(401);
    expect(status.json()).toEqual({ authenticated: false });
    await app.close();
  });
});
