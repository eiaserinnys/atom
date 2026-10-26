import type { FastifyInstance } from "fastify";
import { eventBus } from "../../events/eventBus.js";
import type { AtomEvent } from "../../events/eventBus.js";
import { resolveAllowedCorsOrigin } from "../page_access.js";
import { decodeJwt } from "jose";
import { getDb } from "../../db/client.js";
import { findUserById } from "../../db/queries/users.js";
import { JWT_COOKIE_NAME } from "./auth_helpers.js";

const userConnections = new Map<string, Set<() => void>>();

export function closeUserEventConnections(userId: string): void {
  for (const close of userConnections.get(userId) ?? []) close();
}

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  // GET /events — SSE endpoint for real-time atom events
  app.get("/events", async (req, reply) => {
    // The global auth middleware has already verified this cookie and user.
    const userId = req.jwtUser?.id;
    const authenticatedUserId = userId && userId !== "bypass" ? userId : undefined;
    const expiresAt = authenticatedUserId
      ? decodeJwt(req.cookies[JWT_COOKIE_NAME]!).exp
      : undefined;
    const frontendUrl = process.env["FRONTEND_URL"];
    const searchMotionPageUrl = process.env["SEARCH_MOTION_PAGE_URL"];
    const allowedOrigin = resolveAllowedCorsOrigin(req, frontendUrl, searchMotionPageUrl);
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    if (allowedOrigin) {
      reply.raw.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
    }
    reply.raw.flushHeaders();

    // Keep connection open — Fastify will not auto-end the response
    await new Promise<void>((resolve) => {
      let closed = false;
      let pending = Promise.resolve();
      const close = () => {
        if (closed) return;
        closed = true;
        eventBus.off("atom:event", listener);
        req.raw.off("close", close);
        if (authenticatedUserId) {
          const connections = userConnections.get(authenticatedUserId)!;
          connections.delete(close);
          if (connections.size === 0) userConnections.delete(authenticatedUserId);
        }
        reply.raw.end();
        resolve();
      };

      const send = async (event: AtomEvent) => {
        if (closed) return;
        if (authenticatedUserId) {
          const user = await findUserById(getDb(), authenticatedUserId);
          if (closed) return;
          if (!user?.is_active || (expiresAt !== undefined && Date.now() >= expiresAt * 1000)) {
            close();
            return;
          }
        }
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      const listener = (event: AtomEvent) => {
        // Preserve event order while each authenticated delivery checks storage.
        pending = pending.then(() => send(event)).catch((err) => {
          req.log.error({ err }, "SSE authorization check failed");
          close();
        });
      };

      if (authenticatedUserId) {
        const connections = userConnections.get(authenticatedUserId) ?? new Set();
        connections.add(close);
        userConnections.set(authenticatedUserId, connections);
      }
      eventBus.on("atom:event", listener);
      req.raw.on("close", close);
    });
  });
}
