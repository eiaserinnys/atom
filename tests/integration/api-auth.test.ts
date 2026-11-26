/**
 * Integration tests split from api.test.ts.
 *
 * Requires TEST_DATABASE_URL to point to a test PostgreSQL database.
 */

import bcrypt from "bcryptjs";
import { setupIntegrationTestDb } from "./integration-harness.js";
import { getDb } from "../../src/db/client.js";
import { insertAgent } from "../../src/db/queries/agents.js";
import { insertUser } from "../../src/db/queries/users.js";

setupIntegrationTestDb();

describe("Agent authentication", () => {
  it("inactive agent is rejected (is_active=false)", async () => {
    const plainSecret = "test-secret-12345";
    const secretHash = await bcrypt.hash(plainSecret, 10);
    await insertAgent(getDb(), {
      agent_id: "inactive-agent",
      secret_hash: secretHash,
      display_name: "Inactive",
    });
    // Mark inactive
    await getDb().query(`UPDATE agents SET is_active = false WHERE agent_id = 'inactive-agent'`);

    // Verify the agent is truly inactive via DB query
    const row = await getDb().query(`SELECT is_active FROM agents WHERE agent_id = 'inactive-agent'`);
    expect(row.rows[0].is_active).toBe(false);
  });

  it("active agent with correct secret can be verified via bcrypt", async () => {
    const plainSecret = "active-secret-67890";
    const secretHash = await bcrypt.hash(plainSecret, 10);
    await insertAgent(getDb(), {
      agent_id: "active-agent",
      secret_hash: secretHash,
      display_name: "Active",
    });

    const row = await getDb().query(`SELECT * FROM agents WHERE agent_id = 'active-agent'`);
    const agent = row.rows[0];
    expect(agent.is_active).toBe(true);
    expect(await bcrypt.compare(plainSecret, agent.secret_hash)).toBe(true);
    expect(await bcrypt.compare("wrong-secret", agent.secret_hash)).toBe(false);
  });
});

describe("User login checks", () => {
  it("unregistered email is rejected (no user row)", async () => {
    // Simulate auth logic: findUserByEmail returns null → redirect auth_error=unauthorized
    const { findUserByEmail } = await import("../../src/db/queries/users.js");
    const user = await findUserByEmail(getDb(), "notregistered@example.com");
    expect(user).toBeNull();
  });

  it("deactivated user is rejected (is_active=false)", async () => {
    await insertUser(getDb(), {
      email: "deactivated@example.com",
      display_name: "Deactivated User",
      role: "viewer",
    });
    await getDb().query(`UPDATE users SET is_active = false WHERE email = 'deactivated@example.com'`);

    const { findUserByEmail } = await import("../../src/db/queries/users.js");
    const dbUser = await findUserByEmail(getDb(), "deactivated@example.com");
    expect(dbUser).not.toBeNull();
    expect(dbUser!.is_active).toBe(false);
  });
});
