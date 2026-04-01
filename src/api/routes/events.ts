import type { FastifyInstance } from "fastify";
import { eventBus } from "../../events/eventBus.js";
import type { AtomEvent } from "../../events/eventBus.js";

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  // GET /events — SSE endpoint for real-time atom events
  app.get("/events", async (req, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("Access-Control-Allow-Origin", "*");
    reply.raw.flushHeaders();

    const listener = (event: AtomEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBus.on("atom:event", listener);

    req.raw.on("close", () => {
      eventBus.off("atom:event", listener);
    });

    // Keep connection open — Fastify will not auto-end the response
    await new Promise<void>((resolve) => {
      req.raw.on("close", resolve);
    });
  });
}
