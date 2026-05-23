import { PostgresAdapter } from "../../src/db/adapters/postgres.js";

export function setupRelativePositionIntegrationTest(): () => PostgresAdapter;

export function createParentWithChildren(
  childCount: number,
  spacing?: number
): Promise<{ parentNodeId: string; childNodeIds: string[] }>;
