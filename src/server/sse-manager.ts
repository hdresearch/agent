// SSE (Server-Sent Events) client management

import { metrics, MetricNames } from "../utils/metrics";

export type SseSendFunction = (event: string, data: unknown) => void;

/**
 * Manages SSE client connections and broadcasts events to all connected clients.
 */
class SseManager {
  private clients: Set<SseSendFunction> = new Set();

  /**
   * Add a new SSE client
   */
  addClient(send: SseSendFunction): void {
    this.clients.add(send);
    metrics.setGauge(MetricNames.SSE_CLIENTS, this.clients.size);
  }

  /**
   * Remove an SSE client
   */
  removeClient(send: SseSendFunction): void {
    this.clients.delete(send);
    metrics.setGauge(MetricNames.SSE_CLIENTS, this.clients.size);
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(type: string, data: unknown): void {
    for (const send of this.clients) {
      send(type, data);
    }
  }

  /**
   * Get the number of connected clients
   */
  get clientCount(): number {
    return this.clients.size;
  }
}

// Singleton instance
export const sseManager = new SseManager();

// Convenience functions that delegate to the singleton
export function addSseClient(send: SseSendFunction): void {
  sseManager.addClient(send);
}

export function removeSseClient(send: SseSendFunction): void {
  sseManager.removeClient(send);
}

export function broadcastEvent(type: string, data: unknown): void {
  sseManager.broadcast(type, data);
}
