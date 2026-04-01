import { EventEmitter } from "events";
import type { Card } from "../shared/types.js";

export type AtomEvent =
  | { type: "card:created"; cardId: string; nodeId: string; parentNodeId: string | null; data: Card }
  | { type: "card:updated"; cardId: string; data: Card }
  | { type: "card:deleted"; cardId: string }
  | { type: "node:created"; nodeId: string; cardId: string; parentNodeId: string | null }
  | { type: "node:deleted"; nodeId: string }
  | { type: "node:moved"; nodeId: string; newParentNodeId: string | null };

class AtomEventBus extends EventEmitter {
  emitAtomEvent(payload: AtomEvent): boolean {
    return super.emit("atom:event", payload);
  }

  onAtomEvent(listener: (payload: AtomEvent) => void): this {
    return super.on("atom:event", listener);
  }

  offAtomEvent(listener: (payload: AtomEvent) => void): this {
    return super.off("atom:event", listener);
  }

  // Keep typed overloads for generic emit/on/off usage
  emit(event: "atom:event", payload: AtomEvent): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  on(event: "atom:event", listener: (payload: AtomEvent) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  off(event: "atom:event", listener: (payload: AtomEvent) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }
}

export const eventBus = new AtomEventBus();
