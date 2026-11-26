const MOVE_WAIT_MS = 2000;
const MOVE_QUIET_MS = 200;

export function findRow(list: HTMLElement, nodeId: string): HTMLElement | null {
  return list.querySelector<HTMLElement>(`[data-testid="tree-node-${nodeId}"] > [data-tree-row]`);
}

function focusIfConnected(target: HTMLElement | null, fallback: HTMLElement): void {
  (target?.isConnected ? target : fallback).focus();
}

export function focusRowOrList(list: HTMLElement, row: HTMLElement | null): void {
  focusIfConnected(row, list);
}

export function focusParentRow(list: HTMLElement, parentNodeId: string | null): void {
  focusIfConnected(parentNodeId ? findRow(list, parentNodeId) : null, list);
}

/**
 * The moved row only exists in its new place once the tree refetches. Focus the new row when it appears. When the
 * old row is gone and no new row has shown up after the tree went quiet, focus the list. Returns a function that
 * stops waiting.
 */
export function focusMovedRow(list: HTMLElement, nodeId: string, oldRow: HTMLElement | null): () => void {
  const newRow = () => {
    const row = findRow(list, nodeId);
    return row && row !== oldRow ? row : null;
  };
  const stolen = () => {
    const active = document.activeElement;
    return active !== null && active !== document.body && !list.contains(active);
  };

  let quietTimer = 0;
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(quietTimer);
    window.clearTimeout(giveUpTimer);
  };
  const finish = (target: HTMLElement | null) => {
    if (!stolen()) (target ?? list).focus();
    stop();
  };
  const observer = new MutationObserver(() => {
    window.clearTimeout(quietTimer);
    const row = newRow();
    if (row) finish(row);
    else if (!oldRow?.isConnected) quietTimer = window.setTimeout(() => finish(null), MOVE_QUIET_MS);
  });
  const giveUpTimer = window.setTimeout(() => finish(newRow() ?? (oldRow?.isConnected ? oldRow : null)), MOVE_WAIT_MS);
  observer.observe(list, { childList: true, subtree: true });
  return stop;
}
