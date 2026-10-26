import Fastify from "fastify";
import type { AddressInfo } from "node:net";
import { eventsRoutes } from "../../src/api/routes/events.js";

const savedEnv = { ...process.env };

async function requestEventsOrigin(origin: string): Promise<string | null> {
  const app = Fastify({ logger: false });
  await app.register(eventsRoutes);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as AddressInfo).port;
  const controller = new AbortController();

  try {
    const response = await fetch("http://127.0.0.1:" + port + "/events", {
      headers: { origin },
      signal: controller.signal,
    });
    return response.headers.get("access-control-allow-origin");
  } finally {
    controller.abort();
    await app.close();
  }
}

describe("SSE CORS origin", () => {
  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env["SEARCH_MOTION_PAGE_URL"];
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("echoes the configured frontend origin without a wildcard", async () => {
    process.env["FRONTEND_URL"] = "https://dashboard.example";

    await expect(requestEventsOrigin("https://dashboard.example")).resolves.toBe(
      "https://dashboard.example",
    );
  });

  it("uses loopback origins only when FRONTEND_URL is unset", async () => {
    delete process.env["FRONTEND_URL"];

    await expect(requestEventsOrigin("http://localhost:15173")).resolves.toBe(
      "http://localhost:15173",
    );
    await expect(requestEventsOrigin("https://attacker.example")).resolves.toBeNull();
  });
});
