import { jest } from "@jest/globals";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eventsRoutes } from "../../src/api/routes/events.js";

const KEEPALIVE = ": keepalive\n\n";

type RouteHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
type CloseListener = () => void;

type Connection = {
  writes: string[];
  end: ReturnType<typeof jest.fn>;
  emitClose: () => void;
  closed: Promise<void>;
};

// Drives the GET /events handler with a fake request/reply pair so the
// keepalive timer can be advanced with jest fake timers.
async function openConnection(): Promise<Connection> {
  let registered: RouteHandler | undefined;
  const fakeApp = {
    get: (_path: string, handler: RouteHandler) => {
      registered = handler;
    },
  };
  await eventsRoutes(fakeApp as unknown as FastifyInstance);
  if (!registered) throw new Error("GET /events handler was not registered");
  const handler = registered;

  const writes: string[] = [];
  const closeListeners = new Set<CloseListener>();
  const replyRaw = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    end: jest.fn(),
  };
  const requestRaw = {
    on: (event: string, listener: CloseListener) => {
      if (event === "close") closeListeners.add(listener);
    },
    off: (event: string, listener: CloseListener) => {
      if (event === "close") closeListeners.delete(listener);
    },
  };
  const req = {
    jwtUser: undefined,
    cookies: {},
    headers: {},
    raw: requestRaw,
    log: { error: jest.fn() },
  } as unknown as FastifyRequest;
  const reply = { raw: replyRaw } as unknown as FastifyReply;

  const closed = handler(req, reply);
  return {
    writes,
    end: replyRaw.end,
    emitClose: () => {
      for (const listener of [...closeListeners]) listener();
    },
    closed,
  };
}

describe("SSE keepalive", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("writes a keepalive comment every 30 seconds", async () => {
    const connection = await openConnection();

    jest.advanceTimersByTime(29_999);
    expect(connection.writes).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(connection.writes).toEqual([KEEPALIVE]);

    jest.advanceTimersByTime(30_000);
    expect(connection.writes).toEqual([KEEPALIVE, KEEPALIVE]);

    connection.emitClose();
    await connection.closed;
  });

  it("stops the keepalive timer when the connection closes", async () => {
    const connection = await openConnection();

    jest.advanceTimersByTime(30_000);
    expect(connection.writes).toEqual([KEEPALIVE]);

    connection.emitClose();
    await connection.closed;
    expect(connection.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    jest.advanceTimersByTime(120_000);
    expect(connection.writes).toEqual([KEEPALIVE]);
  });
});
