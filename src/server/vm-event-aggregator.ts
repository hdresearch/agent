// VM Event Aggregator - multiplexes SSE streams from multiple VMs
// into a single event stream for orchestrator clients

import { logStream } from "../utils/log-stream";
import type {
  SessionNotificationParams,
  VmEventEnvelope,
  VmConnectionInfo,
  VmConnectionStatus,
} from "../protocol/acp-types";

// ============================================================
// Types
// ============================================================

interface VmConnection {
  vmId: string;
  agentUrl: string;
  status: VmConnectionStatus;
  lastEventAt: number;
  reconnectAttempts: number;
  error?: string;
  abortController?: AbortController;
  reconnectTimeout?: Timer;
}

type VmEventSubscriber = (event: VmEventEnvelope) => void;

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  maxReconnectAttempts: 10,
  initialReconnectDelayMs: 100,
  maxReconnectDelayMs: 30000,
  eventBufferSize: 1000, // Per aggregator, not per VM
  connectionTimeoutMs: 10000,
};

// ============================================================
// State
// ============================================================

const connections = new Map<string, VmConnection>();
const subscribers = new Set<VmEventSubscriber>();
const eventBuffer: VmEventEnvelope[] = [];
let globalSeq = 0;

// ============================================================
// Connection Management
// ============================================================

/**
 * Register a VM for event aggregation (without opening a new connection)
 * Use this when the HttpAcpClient is already connected and handling events
 */
export function registerVm(vmId: string, agentUrl: string): void {
  if (!connections.has(vmId)) {
    const connection: VmConnection = {
      vmId,
      agentUrl,
      status: "connected", // Assume connected via HttpAcpClient
      lastEventAt: 0,
      reconnectAttempts: 0,
    };
    connections.set(vmId, connection);
    logStream.info(`[vm-aggregator] Registered VM`, { vmId });
  }
}

/**
 * Receive an event from a VM (called by HttpAcpClient notification handler)
 */
export function receiveVmEvent(vmId: string, notification: SessionNotificationParams): void {
  // Register VM if not already known
  if (!connections.has(vmId)) {
    registerVm(vmId, `https://${vmId}.vm.vers.sh`);
  }

  handleVmEvent(vmId, notification);
}

/**
 * Add a VM connection and start listening to its events
 * Use this for standalone connection (e.g., testing)
 */
export async function addVmConnection(vmId: string, agentUrl: string): Promise<void> {
  // Remove existing connection if any
  if (connections.has(vmId)) {
    removeVmConnection(vmId);
  }

  const connection: VmConnection = {
    vmId,
    agentUrl,
    status: "connecting",
    lastEventAt: 0,
    reconnectAttempts: 0,
  };

  connections.set(vmId, connection);
  logStream.info(`[vm-aggregator] Adding VM connection`, { vmId, agentUrl });

  // Start listening to events
  await connectToVm(connection);
}

/**
 * Remove a VM connection and stop listening
 */
export function removeVmConnection(vmId: string): void {
  const connection = connections.get(vmId);
  if (!connection) return;

  logStream.info(`[vm-aggregator] Removing VM connection`, { vmId });

  // Cancel ongoing connection
  if (connection.abortController) {
    connection.abortController.abort();
  }

  // Clear reconnect timeout
  if (connection.reconnectTimeout) {
    clearTimeout(connection.reconnectTimeout);
  }

  connections.delete(vmId);
}

/**
 * Connect to a VM's /events endpoint and stream events
 */
async function connectToVm(connection: VmConnection): Promise<void> {
  const { vmId, agentUrl } = connection;

  // Create abort controller for this connection
  connection.abortController = new AbortController();
  connection.status = "connecting";

  try {
    const eventsUrl = `${agentUrl}/events`;
    logStream.debug(`[vm-aggregator] Connecting to ${eventsUrl}`);

    const response = await fetch(eventsUrl, {
      signal: connection.abortController.signal,
      // @ts-expect-error - Bun-specific option for self-signed certs
      tls: { rejectUnauthorized: false },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    connection.status = "connected";
    connection.reconnectAttempts = 0;
    logStream.info(`[vm-aggregator] Connected to VM`, { vmId });

    // Stream events
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        logStream.debug(`[vm-aggregator] Stream ended for VM`, { vmId });
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let currentEvent = "";
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7);
        } else if (line.startsWith("data: ")) {
          currentData = line.slice(6);
        } else if (line === "" && currentEvent && currentData) {
          // End of event - process it
          if (currentEvent === "notification") {
            try {
              const notification = JSON.parse(currentData) as SessionNotificationParams;
              handleVmEvent(vmId, notification);
            } catch {
              logStream.debug(`[vm-aggregator] Failed to parse event`, { vmId, data: currentData });
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
  } catch (err) {
    if (connection.abortController?.signal.aborted) {
      // Connection was intentionally closed
      logStream.debug(`[vm-aggregator] Connection aborted`, { vmId });
      return;
    }

    const errorMsg = err instanceof Error ? err.message : String(err);
    connection.status = "error";
    connection.error = errorMsg;
    logStream.warn(`[vm-aggregator] Connection error`, { vmId, error: errorMsg });
  }

  // Handle disconnection - attempt reconnect
  if (connections.has(vmId)) {
    connection.status = "disconnected";
    scheduleReconnect(connection);
  }
}

/**
 * Schedule a reconnection attempt with exponential backoff
 */
function scheduleReconnect(connection: VmConnection): void {
  if (connection.reconnectAttempts >= CONFIG.maxReconnectAttempts) {
    logStream.warn(`[vm-aggregator] Max reconnect attempts reached`, { vmId: connection.vmId });
    connection.status = "error";
    connection.error = "Max reconnect attempts reached";
    return;
  }

  connection.reconnectAttempts++;

  // Exponential backoff
  const delay = Math.min(
    CONFIG.initialReconnectDelayMs * Math.pow(2, connection.reconnectAttempts - 1),
    CONFIG.maxReconnectDelayMs
  );

  logStream.debug(`[vm-aggregator] Scheduling reconnect`, {
    vmId: connection.vmId,
    attempt: connection.reconnectAttempts,
    delayMs: delay,
  });

  connection.reconnectTimeout = setTimeout(() => {
    if (connections.has(connection.vmId)) {
      connectToVm(connection);
    }
  }, delay);
}

/**
 * Handle an event received from a VM
 */
function handleVmEvent(vmId: string, notification: SessionNotificationParams): void {
  const connection = connections.get(vmId);
  if (connection) {
    connection.lastEventAt = Date.now();
  }

  // Create envelope with sequence number
  const envelope: VmEventEnvelope = {
    vmId,
    timestamp: new Date().toISOString(),
    seq: ++globalSeq,
    event: notification,
  };

  // Add to buffer (circular)
  eventBuffer.push(envelope);
  if (eventBuffer.length > CONFIG.eventBufferSize) {
    eventBuffer.shift();
  }

  // Notify subscribers
  for (const subscriber of subscribers) {
    try {
      subscriber(envelope);
    } catch (err) {
      logStream.debug(`[vm-aggregator] Subscriber error`, { error: err });
    }
  }
}

// ============================================================
// Subscription API
// ============================================================

/**
 * Subscribe to aggregated VM events
 * Returns an unsubscribe function
 */
export function subscribeToVmEvents(callback: VmEventSubscriber): () => void {
  subscribers.add(callback);
  logStream.debug(`[vm-aggregator] Subscriber added`, { count: subscribers.size });

  return () => {
    subscribers.delete(callback);
    logStream.debug(`[vm-aggregator] Subscriber removed`, { count: subscribers.size });
  };
}

/**
 * Get events since a sequence number (for polling)
 */
export function getEventsSince(afterSeq: number, vmIds?: string[], limit = 100): VmEventEnvelope[] {
  let events = eventBuffer.filter((e) => e.seq > afterSeq);

  // Filter by vmIds if specified
  if (vmIds && vmIds.length > 0) {
    const vmIdSet = new Set(vmIds);
    events = events.filter((e) => vmIdSet.has(e.vmId));
  }

  // Apply limit
  if (events.length > limit) {
    events = events.slice(-limit);
  }

  return events;
}

/**
 * Get the current global sequence number
 */
export function getLastSeq(): number {
  return globalSeq;
}

// ============================================================
// Status API
// ============================================================

/**
 * Get connection status for all VMs
 */
export function getConnectionStatus(): Map<string, VmConnectionInfo> {
  const status = new Map<string, VmConnectionInfo>();

  for (const [vmId, conn] of connections) {
    status.set(vmId, {
      vmId,
      status: conn.status,
      lastEventAt: conn.lastEventAt > 0 ? new Date(conn.lastEventAt).toISOString() : undefined,
      error: conn.error,
      reconnectAttempts: conn.reconnectAttempts,
    });
  }

  return status;
}

/**
 * Get connection status as a plain object (for JSON serialization)
 */
export function getConnectionStatusObject(): Record<string, VmConnectionInfo> {
  const result: Record<string, VmConnectionInfo> = {};

  for (const [vmId, info] of getConnectionStatus()) {
    result[vmId] = info;
  }

  return result;
}

/**
 * Check if a VM is connected
 */
export function isVmConnected(vmId: string): boolean {
  const conn = connections.get(vmId);
  return conn?.status === "connected";
}

/**
 * Get list of connected VM IDs
 */
export function getConnectedVmIds(): string[] {
  return Array.from(connections.keys()).filter((vmId) => isVmConnected(vmId));
}

// ============================================================
// Cleanup
// ============================================================

/**
 * Clean up all connections
 */
export function cleanup(): void {
  logStream.info(`[vm-aggregator] Cleaning up all connections`);

  for (const vmId of connections.keys()) {
    removeVmConnection(vmId);
  }

  subscribers.clear();
  eventBuffer.length = 0;
  globalSeq = 0;
}
