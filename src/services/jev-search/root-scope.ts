import { InvalidInputError, NotFoundError } from "../service-errors.js";
import { JevSearchRequestError } from "./config.js";

/** Jev callers see coded errors; the shared root check speaks in plain ServiceErrors. */
export async function normalizeJevRootNodeId(
  normalize: (rootNodeId: string | null | undefined) => Promise<string | null | undefined>,
  rootNodeId: string | null | undefined
): Promise<string | null | undefined> {
  try {
    return await normalize(rootNodeId);
  } catch (error) {
    if (error instanceof NotFoundError) throw new JevSearchRequestError(error.message, "JEV_ROOT_NOT_FOUND", 404);
    if (error instanceof InvalidInputError) throw new JevSearchRequestError(error.message, "JEV_ROOT_INVALID", 400);
    throw error;
  }
}
