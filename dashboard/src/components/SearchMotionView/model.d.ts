export interface EventNode { nodeId: string; title: string; selected: boolean; rank: number; score: number; asked: { step: string; key: string } | null }
export interface EventModel { nodes: Map<string, EventNode>; maxHop: number; terminal: { stop: string }; calls: Map<string, { request: { questions: Record<string, { instructions: string }> } }> }
export function createModel(): EventModel;
export function applyEvent(model: EventModel, event: unknown): unknown;
export function eventsFromResponse(response: unknown): unknown[];
