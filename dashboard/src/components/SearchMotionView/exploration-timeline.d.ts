export interface ExplorationFrame {
  id: string;
  segmentId?: string;
  operationId?: string;
  kind?: 'expand' | 'evaluate';
  sourceCardId?: string | null;
  query?: string | null;
  events: Array<Record<string, any>>;
  eventEndIndex?: number;
}

export interface ExplorationTimeline {
  frames: ExplorationFrame[];
  operationEvents: Array<Record<string, any>>;
  operations: Array<Record<string, any>>;
}

export interface ExplorationChapter {
  id: string;
  label: string;
  operationIds: string[];
  frameIds: string[];
}

export function buildExplorationTimeline(initialFrames: ExplorationFrame[], operationEvents: Array<Record<string, any>>): ExplorationTimeline;
export function projectAt<T>(timeline: ExplorationTimeline, cursor: number, initialState: T, reducer: (state: T, event: Record<string, any>) => T): T;
export function truncateTimeline(timeline: ExplorationTimeline, cursor: number): ExplorationTimeline;
export function groupExplorationChapters(timeline: ExplorationTimeline): ExplorationChapter[];
