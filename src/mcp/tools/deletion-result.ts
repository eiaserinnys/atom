import type { DeletionSummary } from "../../services/node-deletion.service.js";

export function deletionResultContent(summary: DeletionSummary, dryRun: boolean) {
  const body = {
    deleted: !dryRun,
    deleted_card_ids: summary.deletedCardIds,
    deleted_node_count: summary.deletedNodeCount,
    ...(dryRun ? { dry_run: true } : {}),
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}

export const DRY_RUN_DESCRIPTION =
  "true = delete nothing and only report what would be deleted (deleted is false, dry_run is true). Default false.";
