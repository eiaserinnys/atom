import type { ExplorationProjection } from './exploration-model';
import type { ExplorationTimeline, ExplorationChapter } from './exploration-timeline';
export interface ExplorationLog {
  entries: Array<{ type: 'search' | 'operation'; id: string; events: any[] }>;
  query: string;
  revision: number;
  serial: number;
  selections: Array<{ frameId: string; cardId: string }>;
}
export function createExplorationSession(): {
  exportLog(): ExplorationLog;
  restoreLog(log: ExplorationLog): void;
  begin(query: string, options?: { resume?: boolean }): void;
  receive(event: any): void;
  apply(event: any): void;
  timeline(): ExplorationTimeline;
  project(cursor: number, evaluating?: boolean): { scene: any; projection: ExplorationProjection; selectionCardId: string | null };
  select(cardId: string, cursor: number): void;
  truncate(cursor: number): void;
  chapters(): ExplorationChapter[];
  readonly revision: number;
};
