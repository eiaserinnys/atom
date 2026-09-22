/**
 * Agent key verification cache — contract without a database.
 *
 * The verifier keeps the per-request active-agent lookup but skips bcrypt for
 * a key it has already verified, as long as that agent is still active with
 * the same secret_hash. Deps are faked: an in-memory agent table and a
 * compare spy wrapping real bcrypt (cost 4 keeps the suite fast).
 */
import bcrypt from "bcryptjs";
import { jest } from "@jest/globals";

import { createAgentKeyVerifier } from "../../src/api/agent-key-auth.js";
import type { Agent } from "../../src/db/queries/agents.js";

function agentRow(agent_id: string, secret_hash: string): Agent {
  return {
    id: crypto.randomUUID(),
    agent_id,
    secret_hash,
    display_name: null,
    is_active: true,
    created_by: null,
    created_at: "2026-09-22T00:00:00Z",
  };
}

async function makeVerifier(secrets: Record<string, string>) {
  const table: Agent[] = [];
  for (const [agentId, secret] of Object.entries(secrets)) {
    table.push(agentRow(agentId, await bcrypt.hash(secret, 4)));
  }
  const compare = jest.fn((secret: string, hash: string) => bcrypt.compare(secret, hash));
  const findActiveAgents = jest.fn(async () => table.filter((a) => a.is_active));
  const verifier = createAgentKeyVerifier({ findActiveAgents, compareSecret: compare });
  return { verifier, table, compare, findActiveAgents };
}

describe("agent key verifier cache", () => {
  it("runs bcrypt on the first request and skips it on the next one", async () => {
    const { verifier, compare, findActiveAgents } = await makeVerifier({
      alpha: "alpha-secret",
      beta: "beta-secret",
    });

    const first = await verifier.verify("alpha-secret");
    expect(first?.agent_id).toBe("alpha");
    // One compare per active agent on a cold key.
    expect(compare).toHaveBeenCalledTimes(2);

    compare.mockClear();
    const second = await verifier.verify("alpha-secret");
    expect(second?.agent_id).toBe("alpha");
    expect(compare).toHaveBeenCalledTimes(0);
    // The active-agent lookup still runs on every request.
    expect(findActiveAgents).toHaveBeenCalledTimes(2);
  });

  it("never caches a wrong key", async () => {
    const { verifier, compare } = await makeVerifier({ alpha: "alpha-secret" });

    expect(await verifier.verify("wrong-secret")).toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);

    compare.mockClear();
    expect(await verifier.verify("wrong-secret")).toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it("rejects the old key after rotation and verifies the new key", async () => {
    const { verifier, table, compare } = await makeVerifier({ alpha: "old-secret" });
    expect((await verifier.verify("old-secret"))?.agent_id).toBe("alpha");

    // Rotation writes a new hash to the DB row; no explicit cache clear.
    table[0]!.secret_hash = await bcrypt.hash("new-secret", 4);

    compare.mockClear();
    expect(await verifier.verify("old-secret")).toBeNull();
    // The stale entry fell through to bcrypt against the new hash.
    expect(compare).toHaveBeenCalledTimes(1);

    compare.mockClear();
    expect((await verifier.verify("new-secret"))?.agent_id).toBe("alpha");
    expect(compare).toHaveBeenCalledTimes(1);

    compare.mockClear();
    expect((await verifier.verify("new-secret"))?.agent_id).toBe("alpha");
    expect(compare).toHaveBeenCalledTimes(0);

    // The old key stays rejected (its stale entry was dropped, not revived).
    expect(await verifier.verify("old-secret")).toBeNull();
  });

  it("rejects a cached key once its agent is deactivated", async () => {
    const { verifier, table } = await makeVerifier({ alpha: "alpha-secret" });
    expect((await verifier.verify("alpha-secret"))?.agent_id).toBe("alpha");

    table[0]!.is_active = false;
    expect(await verifier.verify("alpha-secret")).toBeNull();

    // Reactivation re-verifies through bcrypt rather than a revived entry.
    table[0]!.is_active = true;
    expect((await verifier.verify("alpha-secret"))?.agent_id).toBe("alpha");
  });

  it("clear() forces the next request back through bcrypt", async () => {
    const { verifier, compare } = await makeVerifier({ alpha: "alpha-secret" });
    await verifier.verify("alpha-secret");

    verifier.clear();
    compare.mockClear();
    expect((await verifier.verify("alpha-secret"))?.agent_id).toBe("alpha");
    expect(compare).toHaveBeenCalledTimes(1);
  });
});
