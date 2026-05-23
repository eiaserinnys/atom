import {
  agentToPublic,
  isAdminRemovalChange,
  wouldRemoveLastAdmin,
} from "../../src/api/config/policy.js";
import type { Agent } from "../../src/db/queries/agents.js";

describe("config policy helpers", () => {
  it("removes secret_hash from public agent responses", () => {
    const agent: Agent = {
      id: "agent-1",
      agent_id: "writer",
      secret_hash: "hash-value",
      display_name: "Writer",
      is_active: true,
      created_by: "user-1",
      created_at: "2026-05-24T00:00:00.000Z",
    };

    const publicAgent = agentToPublic(agent);

    expect(publicAgent).toEqual({
      id: "agent-1",
      agent_id: "writer",
      display_name: "Writer",
      is_active: true,
      created_by: "user-1",
      created_at: "2026-05-24T00:00:00.000Z",
    });
    expect("secret_hash" in publicAgent).toBe(false);
  });

  it("detects only changes that would remove the last active admin", () => {
    const admin = { role: "admin" as const };
    const editor = { role: "editor" as const };

    expect(wouldRemoveLastAdmin(admin, { role: "editor" }, 1)).toBe(true);
    expect(wouldRemoveLastAdmin(admin, { is_active: false }, 1)).toBe(true);
    expect(wouldRemoveLastAdmin(admin, { role: "admin" }, 1)).toBe(false);
    expect(wouldRemoveLastAdmin(admin, { role: "viewer" }, 2)).toBe(false);
    expect(wouldRemoveLastAdmin(editor, { role: "viewer" }, 1)).toBe(false);
  });

  it("detects admin removal changes before counting admins", () => {
    const admin = { role: "admin" as const };
    const editor = { role: "editor" as const };

    expect(isAdminRemovalChange(admin, { role: "editor" })).toBe(true);
    expect(isAdminRemovalChange(admin, { is_active: false })).toBe(true);
    expect(isAdminRemovalChange(admin, { role: "admin" })).toBe(false);
    expect(isAdminRemovalChange(admin, {})).toBe(false);
    expect(isAdminRemovalChange(editor, { role: "viewer" })).toBe(false);
  });
});
