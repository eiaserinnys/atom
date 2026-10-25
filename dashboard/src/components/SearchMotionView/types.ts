export interface MotionNode {
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
