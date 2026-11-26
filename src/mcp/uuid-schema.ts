import { z } from "zod";

import { invalidIdMessage, UUID_PATTERN } from "../shared/uuid.js";

/** The one UUID rule (8-4-4-4-12 hex) of REST and MCP; MCP appends " at <field>" to the message. */
export const uuidSchema = z.string().regex(UUID_PATTERN, {
  error: (issue) => invalidIdMessage("UUID", issue.input),
});
