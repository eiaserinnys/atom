import Fastify from "fastify";

import { eventsRoutes } from "../../src/api/routes/events.js";
import { eventBus } from "../../src/events/eventBus.js";
import type { AtomEvent } from "../../src/events/eventBus.js";

export type EventsTestApp = {
  port: number;
  close: () => Promise<void>;
};

export function nextAtomEvent(timeoutMs = 5000): Promise<AtomEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventBus.off("atom:event", handler);
      reject(new Error("Timed out waiting for atom:event"));
    }, timeoutMs);

    const handler = (event: AtomEvent) => {
      clearTimeout(timer);
      eventBus.off("atom:event", handler);
      resolve(event);
    };

    eventBus.on("atom:event", handler);
  });
}

export async function buildEventsTestApp(): Promise<EventsTestApp> {
  const testApp = Fastify({ logger: false });
  testApp.register(eventsRoutes);
  await testApp.listen({ port: 0, host: "127.0.0.1" });

  const addr = testApp.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    port,
    close: () => testApp.close(),
  };
}
