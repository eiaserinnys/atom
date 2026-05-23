import { mapPostgresConnectionError } from "../../src/api/config/db-test.js";

describe("config db-test helpers", () => {
  it.each([
    [{ code: "ECONNREFUSED" }, "Connection refused: check host and port"],
    [{ message: "connect ECONNREFUSED 127.0.0.1" }, "Connection refused: check host and port"],
    [{ code: "28P01" }, "Authentication failed: check username/password"],
    [{ code: "3D000" }, "Database does not exist"],
    [new Error("custom failure"), "custom failure"],
    ["plain failure", "plain failure"],
  ])("maps %p to %s", (error, expected) => {
    expect(mapPostgresConnectionError(error)).toBe(expected);
  });
});
