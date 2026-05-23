/**
 * Integration tests for atom Event Bus SSE endpoint.
 *
 * Requires TEST_DATABASE_URL to point to a running PostgreSQL test instance.
 */

import http from "http";

import * as cardService from "../../src/services/card.service.js";
import { setupIntegrationTestDb } from "./integration-harness.js";
import {
  buildEventsTestApp,
  type EventsTestApp,
} from "./events-fixtures.js";

setupIntegrationTestDb();

let testApp: EventsTestApp;

beforeAll(async () => {
  testApp = await buildEventsTestApp();
}, 30000);

afterAll(async () => {
  await testApp.close();
}, 10000);

describe("SSE endpoint — HTTP cases", () => {
  it("GET /events responds with SSE headers", (done) => {
    const req = http.get(
      `http://127.0.0.1:${testApp.port}/events`,
      (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        expect(res.headers["cache-control"]).toContain("no-cache");
        req.destroy();
        done();
      }
    );
    req.on("error", done);
  });

  it("SSE delivers mutation event to connected client", (done) => {
    let cardId: string;
    let chunks = "";
    let finished = false;
    let mutationTimer: NodeJS.Timeout | undefined;
    let safetyTimer: NodeJS.Timeout | undefined;
    const finish = (err?: unknown) => {
      if (finished) return;
      finished = true;
      if (mutationTimer) clearTimeout(mutationTimer);
      if (safetyTimer) clearTimeout(safetyTimer);
      if (err) done(err);
      else done();
    };

    const req = http.get(
      `http://127.0.0.1:${testApp.port}/events`,
      (res) => {
        res.setEncoding("utf-8");

        res.on("data", (chunk: string) => {
          chunks += chunk;
          if (chunks.includes("card:created")) {
            req.destroy();
          }
        });

        res.on("close", () => {
          try {
            expect(chunks).toContain("card:created");
            expect(chunks).toContain(cardId);
            finish();
          } catch (err) {
            finish(err);
          }
        });

        // Trigger mutation after SSE connection is established
        mutationTimer = setTimeout(async () => {
          try {
            const { card } = await cardService.createCard({
              card_type: "knowledge",
              title: "SSE Test Card",
            });
            cardId = card.id;
          } catch (err) {
            finish(err);
          }
        }, 100);
      }
    );

    req.on("error", (err) => {
      // Ignore aborted error from req.destroy()
      if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") {
        finish(err);
      }
    });

    // Safety timeout
    safetyTimer = setTimeout(() => {
      req.destroy();
    }, 4000);
  });
});
