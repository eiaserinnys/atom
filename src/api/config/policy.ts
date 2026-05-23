import type { FastifyReply, FastifyRequest } from "fastify";
import type { Agent } from "../../db/queries/agents.js";
import type { UserRole } from "../../shared/types.js";

const ROLE_LEVEL: Record<UserRole, number> = { admin: 3, editor: 2, viewer: 1 };

export function requireRole(
  req: FastifyRequest,
  reply: FastifyReply,
  minRole: UserRole,
): boolean {
  const user = req.jwtUser;
  if (!user) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  if ((ROLE_LEVEL[user.role] ?? 0) < ROLE_LEVEL[minRole]) {
    reply.code(403).send({ error: "Forbidden" });
    return false;
  }
  return true;
}

export function agentToPublic(agent: Agent): Omit<Agent, "secret_hash"> {
  const { secret_hash: _secretHash, ...pub } = agent;
  return pub;
}

export function isAdminRemovalChange(
  targetUser: { role: UserRole },
  changes: { role?: UserRole; is_active?: boolean },
): boolean {
  if (targetUser.role !== "admin") return false;
  const demoting = changes.role !== undefined && changes.role !== "admin";
  const deactivating = changes.is_active === false;
  return demoting || deactivating;
}

export function wouldRemoveLastAdmin(
  targetUser: { role: UserRole },
  changes: { role?: UserRole; is_active?: boolean },
  adminCount: number,
): boolean {
  return isAdminRemovalChange(targetUser, changes) && adminCount <= 1;
}
