/** Shared in-memory state accessible by multiple route modules. */

let _pendingRestart = false;

export function getPendingRestart(): boolean {
  return _pendingRestart;
}

export function setPendingRestart(value: boolean): void {
  _pendingRestart = value;
}
