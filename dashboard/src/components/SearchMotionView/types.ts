export interface MotionNode {
  cardId?: string | null;
  displayColumn?: string;
  columnLabel?: string;
  nodeId: string | null;
  title: string;
  type: string;
  path: string[];
  summary: string | null;
  score: number | null;
  selected: boolean;
  rank: number;
  hop: number;
  reason: string;
  sentText: string;
  sample: boolean;
}
