import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";

import { getDb } from "../db/client.js";
import { findActiveAgents, type Agent } from "../db/queries/agents.js";

/**
 * Agent key (x-api-key) verification with a per-process cache of keys that
 * already passed bcrypt.
 *
 * bcrypt is deliberately slow (~0.4s per compare at cost 10, pure-JS
 * bcryptjs, CPU-bound), and every agent request used to pay it. The active
 * agents are still read from the DB on every request; only the bcrypt compare
 * is skipped for a key whose sha256 digest was verified before.
 *
 * Invalidation is the DB cross-check: a cached entry is honored only while an
 * active agent with the same agent_id still has the exact secret_hash that
 * the key was verified against. Reissuing a secret or deactivating the agent
 * therefore rejects the old key on its very next request, in any process.
 * `clear()` is called by the agent config routes as well, so entries of
 * retired secrets do not linger in memory.
 *
 * Failed keys are never cached.
 */
export interface AgentKeyVerifierDeps {
  findActiveAgents(): Promise<Agent[]>;
  compareSecret(secret: string, secretHash: string): Promise<boolean>;
}

export interface AgentKeyVerifier {
  /** The active agent owning `secret`, or null. */
  verify(secret: string): Promise<Agent | null>;
  /** Drop every cached key; the next request of each key runs bcrypt again. */
  clear(): void;
}

interface VerifiedKey {
  agent_id: string;
  secret_hash: string;
}

function digestOf(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function createAgentKeyVerifier(deps: AgentKeyVerifierDeps): AgentKeyVerifier {
  const verified = new Map<string, VerifiedKey>();

  return {
    async verify(secret) {
      const agents = await deps.findActiveAgents();
      const digest = digestOf(secret);

      const cached = verified.get(digest);
      if (cached) {
        const agent = agents.find(
          (a) => a.agent_id === cached.agent_id && a.secret_hash === cached.secret_hash
        );
        if (agent) return agent;
        verified.delete(digest);
      }

      const agent =
        (
          await Promise.all(
            agents.map(async (a) => ((await deps.compareSecret(secret, a.secret_hash)) ? a : null))
          )
        ).find((a): a is Agent => a !== null) ?? null;
      if (agent) {
        verified.set(digest, { agent_id: agent.agent_id, secret_hash: agent.secret_hash });
      }
      return agent;
    },

    clear() {
      verified.clear();
    },
  };
}

/** The process-wide verifier shared by the card API and the MCP endpoint. */
export const agentKeyVerifier: AgentKeyVerifier = createAgentKeyVerifier({
  findActiveAgents: () => findActiveAgents(getDb()),
  compareSecret: (secret, secretHash) => bcrypt.compare(secret, secretHash),
});

/** Fastify preHandler for routes authenticated by an agent key. */
export async function agentKeyPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = req.headers["x-api-key"] as string | undefined;
  if (!secret) {
    return reply.code(401).send({ error: "x-api-key header required" });
  }
  if (!(await agentKeyVerifier.verify(secret))) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}
