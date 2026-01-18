/**
 * OCapN/CapTP HTTP Server - Port 9323
 * 
 * Implements the Object Capability Network protocol
 * for the 26-goblin mesh with GF(3) conservation.
 * 
 * Endpoints:
 *   GET  /         - Health check
 *   GET  /mesh     - Full mesh status
 *   POST /ocapn    - OCapN operations (handshake, deliver, fulfill, etc.)
 * 
 * Post-Handshake Protocol:
 *   op:hello    → Initial handshake, exchange sturdyrefs
 *   op:deliver  → Invoke method on remote goblin (returns vow)
 *   op:fulfill  → Resolve a vow with a value
 *   op:break    → Reject a vow with an error
 *   op:listen   → Subscribe to goblin events
 *   op:handoff  → Transfer capability to another node
 *   op:gc       → Garbage collect unused references
 */

import { encode, decode, type SyrupRecord } from "./syrup";
import { canAccess, type Trit as SessionTrit, type ColorRef } from "./captp-session";

// GF(3) Trit type
type Trit = -1 | 0 | 1;

// Sturdyref: persistent capability reference
interface SturdyRef {
  uri: string;
  seed: number;
  index: number;
  color?: string;
  trit?: Trit;
}

// Peer info
interface PeerInfo {
  node: string;
  ip: string;
  port: number;
  sturdyrefs: SturdyRef[];
  connectedAt: string;
}

// Vow (Promise) for async capability invocation
interface Vow {
  id: string;
  status: 'pending' | 'fulfilled' | 'broken';
  target: SturdyRef;
  method: string;
  args: unknown[];
  result?: unknown;
  error?: string;
  createdAt: string;
  resolvedAt?: string;
  listeners: string[]; // peer nodes listening for resolution
}

// Listener subscription
interface Listener {
  id: string;
  goblinIndex: number;
  peerNode: string;
  events: string[]; // event types to listen for
  createdAt: string;
}

// Mesh state
interface MeshState {
  localNode: string;
  localIP: string;
  port: number;
  seed: number;
  goblins: SturdyRef[];
  peers: Map<string, PeerInfo>;
  vows: Map<string, Vow>;
  listeners: Map<string, Listener>;
  handshakeCount: number;
  deliverCount: number;
  gf3Sum: number;
}

// ═══════════════════════════════════════════════════════════════
// TIME-TRAVEL: Transactional Snapshots (à la Goblins)
// ═══════════════════════════════════════════════════════════════

// Snapshot of mesh state for time-travel debugging
interface MeshSnapshot {
  id: string;
  timestamp: number;
  label?: string;
  // Deep copies of mutable state
  goblins: SturdyRef[];
  peers: [string, PeerInfo][];
  vows: [string, Vow][];
  listeners: [string, Listener][];
  // Counters at snapshot time
  handshakeCount: number;
  deliverCount: number;
  gf3Sum: number;
}

// Message log for replay
interface MessageLog {
  timestamp: number;
  op: string;
  body: OCapNRequest;
  response?: unknown;
}

// Snapshot storage (transactional heap analog)
const snapshots: Map<string, MeshSnapshot> = new Map();
const messageLog: MessageLog[] = [];
let snapshotCounter = 0;

/**
 * Save a snapshot of the current mesh state.
 * This is the TypeScript equivalent of Goblins' `copy-actor-map`.
 * 
 * Key insight from Christine's talk: "The entire state of the world
 * is held in this actor map... we can just copy it."
 */
function saveSnapshot(label?: string): MeshSnapshot {
  const id = `snapshot-${++snapshotCounter}`;
  
  const snapshot: MeshSnapshot = {
    id,
    timestamp: Date.now(),
    label,
    // Deep copy all mutable state
    goblins: JSON.parse(JSON.stringify(meshState.goblins)),
    peers: Array.from(meshState.peers.entries()).map(
      ([k, v]) => [k, JSON.parse(JSON.stringify(v))] as [string, PeerInfo]
    ),
    vows: Array.from(meshState.vows.entries()).map(
      ([k, v]) => [k, JSON.parse(JSON.stringify(v))] as [string, Vow]
    ),
    listeners: Array.from(meshState.listeners.entries()).map(
      ([k, v]) => [k, JSON.parse(JSON.stringify(v))] as [string, Listener]
    ),
    // Capture counters
    handshakeCount: meshState.handshakeCount,
    deliverCount: meshState.deliverCount,
    gf3Sum: meshState.gf3Sum,
  };
  
  snapshots.set(id, snapshot);
  console.log(`[TIME-TRAVEL] Snapshot saved: ${id}${label ? ` (${label})` : ''}`);
  
  return snapshot;
}

/**
 * Restore mesh state from a snapshot.
 * This enables "time-travel" - rewinding to a previous state.
 * 
 * From the transcript: "We restored the old copy of the actor map...
 * the entire state of the universe is just rewound."
 */
function restoreSnapshot(snapshotId: string): boolean {
  const snapshot = snapshots.get(snapshotId);
  if (!snapshot) {
    console.error(`[TIME-TRAVEL] Snapshot not found: ${snapshotId}`);
    return false;
  }
  
  // Restore all mutable state from snapshot
  meshState.goblins.length = 0;
  meshState.goblins.push(...JSON.parse(JSON.stringify(snapshot.goblins)));
  
  meshState.peers.clear();
  for (const [k, v] of snapshot.peers) {
    meshState.peers.set(k, JSON.parse(JSON.stringify(v)));
  }
  
  meshState.vows.clear();
  for (const [k, v] of snapshot.vows) {
    meshState.vows.set(k, JSON.parse(JSON.stringify(v)));
  }
  
  meshState.listeners.clear();
  for (const [k, v] of snapshot.listeners) {
    meshState.listeners.set(k, JSON.parse(JSON.stringify(v)));
  }
  
  // Restore counters
  meshState.handshakeCount = snapshot.handshakeCount;
  meshState.deliverCount = snapshot.deliverCount;
  meshState.gf3Sum = snapshot.gf3Sum;
  
  console.log(`[TIME-TRAVEL] Restored to: ${snapshotId} (${new Date(snapshot.timestamp).toISOString()})`);
  return true;
}

/**
 * Replay messages from the log starting at a given index.
 * Used for optimistic concurrency: restore snapshot, then replay
 * with the canonical sequence of messages.
 */
function getMessagesSince(snapshotId: string): MessageLog[] {
  const snapshot = snapshots.get(snapshotId);
  if (!snapshot) return [];
  
  return messageLog.filter(m => m.timestamp > snapshot.timestamp);
}

/**
 * List all available snapshots for debugging.
 */
function listSnapshots(): Array<{ id: string; timestamp: number; label?: string }> {
  return Array.from(snapshots.values()).map(s => ({
    id: s.id,
    timestamp: s.timestamp,
    label: s.label,
  }));
}

// Generate deterministic color from seed and index (simplified Golden Angle)
function colorAt(seed: number, index: number): string {
  const phi = 1.618033988749895;
  const goldenAngle = 360 / (phi * phi); // ~137.508°
  const hue = ((seed * 137 + index * goldenAngle) % 360);
  const saturation = 70;
  const lightness = 55;
  return hslToHex(hue, saturation, lightness);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// Compute GF(3) trit from index
function computeTrit(index: number): Trit {
  const mod = index % 3;
  return mod === 0 ? 0 : mod === 1 ? 1 : -1;
}

// Initialize mesh state
function initMeshState(): MeshState {
  const seed = 1069; // Canonical seed
  const goblins: SturdyRef[] = [];
  
  // Generate 26 goblin sturdyrefs
  for (let i = 0; i < 26; i++) {
    goblins.push({
      uri: `ocapn://tailscale/barton-i/goblin-${i}`,
      seed,
      index: i,
      color: colorAt(seed, i),
      trit: computeTrit(i),
    });
  }
  
  return {
    localNode: "barton-i",
    localIP: "100.69.33.107",
    port: 9323,
    seed,
    goblins,
    peers: new Map(),
    vows: new Map(),
    listeners: new Map(),
    handshakeCount: 0,
    deliverCount: 0,
    gf3Sum: 0,
  };
}

// Generate unique vow ID
function generateVowId(): string {
  return `vow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Generate unique listener ID
function generateListenerId(): string {
  return `listen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const meshState = initMeshState();

// Handle health check
function handleHealth(): Response {
  return Response.json({
    status: "ok",
    node: meshState.localNode,
    endpoint: `ocapn://tailscale/${meshState.localNode}/captp:${meshState.port}`,
    goblins: meshState.goblins.length,
    peers: meshState.peers.size,
    handshakes: meshState.handshakeCount,
    gf3Sum: meshState.gf3Sum,
    gf3Balanced: meshState.gf3Sum % 3 === 0,
  });
}

// Handle mesh status
function handleMeshStatus(): Response {
  const peers = Array.from(meshState.peers.values()).map(p => ({
    node: p.node,
    ip: p.ip,
    port: p.port,
    sturdyrefsCount: p.sturdyrefs.length,
    connectedAt: p.connectedAt,
  }));
  
  return Response.json({
    local: {
      node: meshState.localNode,
      ip: meshState.localIP,
      port: meshState.port,
      seed: meshState.seed,
      endpoint: `ocapn://tailscale/${meshState.localNode}/captp:${meshState.port}`,
    },
    goblins: meshState.goblins,
    peers,
    stats: {
      totalGoblins: meshState.goblins.length,
      totalPeers: meshState.peers.size,
      handshakeCount: meshState.handshakeCount,
      gf3Sum: meshState.gf3Sum,
      gf3Balanced: meshState.gf3Sum % 3 === 0,
    },
  });
}

// Handle op:hello (initial handshake)
function handleHello(body: OCapNRequest): Response {
  const { from, seed, sturdyrefs, trit } = body;
  
  // Track GF(3) trit if provided
  if (trit !== undefined) {
    meshState.gf3Sum += trit;
  }
  
  // Register peer if from info provided
  if (from?.node && from?.ip) {
    const peerId = `${from.node}@${from.ip}`;
    const peerInfo: PeerInfo = {
      node: from.node,
      ip: from.ip,
      port: from.port || 9324,
      sturdyrefs: sturdyrefs || [],
      connectedAt: new Date().toISOString(),
    };
    meshState.peers.set(peerId, peerInfo);
    console.log(`[OCapN] Peer registered: ${peerId}`);
  }
  
  meshState.handshakeCount++;
  
  // Respond with our sturdyrefs
  const responseTrit: Trit = 0; // Coordinator response (ERGODIC)
  meshState.gf3Sum += responseTrit;
  
  const response = {
    op: "op:hello-ack",
    status: "ready",
    from: {
      node: meshState.localNode,
      ip: meshState.localIP,
      port: meshState.port,
    },
    seed: meshState.seed,
    sturdyrefs: meshState.goblins,
    trit: responseTrit,
    gf3: {
      localSum: meshState.gf3Sum,
      balanced: meshState.gf3Sum % 3 === 0,
    },
    syrup: encode({
      tag: Symbol.for("op:hello-ack"),
      fields: [meshState.localNode, meshState.goblins.length],
    } as SyrupRecord),
  };
  
  console.log(`[OCapN] Handshake #${meshState.handshakeCount} complete. GF(3) sum: ${meshState.gf3Sum}`);
  return Response.json(response);
}

// Handle op:deliver (invoke method on goblin, returns vow)
function handleDeliver(body: OCapNRequest): Response {
  const { target, method, args, from, trit } = body;
  
  if (!target || target.index === undefined) {
    return Response.json({ error: "target.index required" }, { status: 400 });
  }
  
  if (!method) {
    return Response.json({ error: "method required" }, { status: 400 });
  }
  
  // Find the target goblin
  const goblin = meshState.goblins[target.index];
  if (!goblin) {
    return Response.json({ 
      error: `Goblin ${target.index} not found`,
      available: meshState.goblins.length,
    }, { status: 404 });
  }
  
  // GF(3) access control check
  if (trit !== undefined) {
    const requesterTrit = trit as SessionTrit;
    const targetTrit = (goblin.trit || 0) as SessionTrit;
    const requesterRef: ColorRef = { hex: '', seed: 0, index: 0, trit: requesterTrit };
    const targetRef: ColorRef = { hex: goblin.color || '', seed: meshState.seed, index: goblin.index, trit: targetTrit };
    
    if (!canAccess(requesterRef, targetRef)) {
      return Response.json({
        error: "Access denied by GF(3) trit policy",
        requesterTrit,
        targetTrit,
        rule: "PLUS→any, ERGODIC→ERGODIC|MINUS, MINUS→MINUS only",
      }, { status: 403 });
    }
    meshState.gf3Sum += trit;
  }
  
  // Create a vow (promise) for this invocation
  const vowId = generateVowId();
  const vow: Vow = {
    id: vowId,
    status: 'pending',
    target: goblin,
    method,
    args: args || [],
    createdAt: new Date().toISOString(),
    listeners: from?.node ? [from.node] : [],
  };
  meshState.vows.set(vowId, vow);
  meshState.deliverCount++;
  
  console.log(`[OCapN] Deliver #${meshState.deliverCount}: ${method} → goblin-${target.index} (${goblin.color})`);
  
  // Execute the method (simulated - in real implementation, this would dispatch to actual goblin logic)
  const result = executeGoblinMethod(goblin, method, args || []);
  
  // If synchronous result available, fulfill immediately
  if (result !== undefined) {
    vow.status = 'fulfilled';
    vow.result = result;
    vow.resolvedAt = new Date().toISOString();
  }
  
  const responseTrit: Trit = 1; // Delivery is generative (+1)
  meshState.gf3Sum += responseTrit;
  
  return Response.json({
    op: "op:deliver-ack",
    vowId,
    status: vow.status,
    result: vow.result,
    target: {
      index: goblin.index,
      color: goblin.color,
      trit: goblin.trit,
    },
    trit: responseTrit,
    gf3: {
      localSum: meshState.gf3Sum,
      balanced: meshState.gf3Sum % 3 === 0,
    },
    syrup: encode({
      tag: Symbol.for("op:deliver-ack"),
      fields: [vowId, vow.status, JSON.stringify(vow.result ?? null)],
    } as SyrupRecord),
  });
}

// Execute method on goblin (extensible dispatch)
function executeGoblinMethod(goblin: SturdyRef, method: string, args: unknown[]): unknown {
  switch (method) {
    case 'ping':
      return { pong: true, goblin: goblin.index, color: goblin.color, timestamp: Date.now() };
    
    case 'identify':
      return { 
        uri: goblin.uri, 
        seed: goblin.seed, 
        index: goblin.index,
        color: goblin.color,
        trit: goblin.trit,
      };
    
    case 'echo':
      return { echo: args[0], goblin: goblin.index };
    
    case 'trit':
      return { trit: goblin.trit, role: goblin.trit === 1 ? 'PLUS' : goblin.trit === -1 ? 'MINUS' : 'ERGODIC' };
    
    case 'capabilities':
      return {
        methods: ['ping', 'identify', 'echo', 'trit', 'capabilities', 'prompt'],
        goblin: goblin.index,
      };
    
    case 'prompt':
      // Placeholder for actual LLM integration
      return {
        response: `[goblin-${goblin.index}] Received prompt: ${args[0]}`,
        status: 'queued',
        color: goblin.color,
      };
    
    default:
      return { error: `Unknown method: ${method}`, availableMethods: ['ping', 'identify', 'echo', 'trit', 'capabilities', 'prompt'] };
  }
}

// Handle op:fulfill (resolve a vow)
function handleFulfill(body: OCapNRequest): Response {
  const { vowId, result, trit } = body;
  
  if (!vowId) {
    return Response.json({ error: "vowId required" }, { status: 400 });
  }
  
  const vow = meshState.vows.get(vowId);
  if (!vow) {
    return Response.json({ error: `Vow ${vowId} not found` }, { status: 404 });
  }
  
  if (vow.status !== 'pending') {
    return Response.json({ 
      error: `Vow ${vowId} already ${vow.status}`,
      resolvedAt: vow.resolvedAt,
    }, { status: 409 });
  }
  
  vow.status = 'fulfilled';
  vow.result = result;
  vow.resolvedAt = new Date().toISOString();
  
  if (trit !== undefined) {
    meshState.gf3Sum += trit;
  }
  
  const responseTrit: Trit = -1; // Fulfillment is consumptive (-1)
  meshState.gf3Sum += responseTrit;
  
  console.log(`[OCapN] Fulfilled vow ${vowId}`);
  
  return Response.json({
    op: "op:fulfill-ack",
    vowId,
    status: 'fulfilled',
    result,
    trit: responseTrit,
    gf3: {
      localSum: meshState.gf3Sum,
      balanced: meshState.gf3Sum % 3 === 0,
    },
  });
}

// Handle op:break (reject a vow)
function handleBreak(body: OCapNRequest): Response {
  const { vowId, error, trit } = body;
  
  if (!vowId) {
    return Response.json({ error: "vowId required" }, { status: 400 });
  }
  
  const vow = meshState.vows.get(vowId);
  if (!vow) {
    return Response.json({ error: `Vow ${vowId} not found` }, { status: 404 });
  }
  
  if (vow.status !== 'pending') {
    return Response.json({ 
      error: `Vow ${vowId} already ${vow.status}`,
      resolvedAt: vow.resolvedAt,
    }, { status: 409 });
  }
  
  vow.status = 'broken';
  vow.error = error || 'Unknown error';
  vow.resolvedAt = new Date().toISOString();
  
  if (trit !== undefined) {
    meshState.gf3Sum += trit;
  }
  
  const responseTrit: Trit = -1; // Breaking is also consumptive (-1)
  meshState.gf3Sum += responseTrit;
  
  console.log(`[OCapN] Broke vow ${vowId}: ${vow.error}`);
  
  return Response.json({
    op: "op:break-ack",
    vowId,
    status: 'broken',
    error: vow.error,
    trit: responseTrit,
    gf3: {
      localSum: meshState.gf3Sum,
      balanced: meshState.gf3Sum % 3 === 0,
    },
  });
}

// Handle op:listen (subscribe to goblin events)
function handleListen(body: OCapNRequest): Response {
  const { target, events, from } = body;
  
  if (!target || target.index === undefined) {
    return Response.json({ error: "target.index required" }, { status: 400 });
  }
  
  if (!from?.node) {
    return Response.json({ error: "from.node required for listeners" }, { status: 400 });
  }
  
  const goblin = meshState.goblins[target.index];
  if (!goblin) {
    return Response.json({ error: `Goblin ${target.index} not found` }, { status: 404 });
  }
  
  const listenerId = generateListenerId();
  const listener: Listener = {
    id: listenerId,
    goblinIndex: target.index,
    peerNode: from.node,
    events: events || ['*'],
    createdAt: new Date().toISOString(),
  };
  meshState.listeners.set(listenerId, listener);
  
  console.log(`[OCapN] Listener ${listenerId} registered for goblin-${target.index} from ${from.node}`);
  
  return Response.json({
    op: "op:listen-ack",
    listenerId,
    goblin: target.index,
    events: listener.events,
    status: 'subscribed',
  });
}

// Handle op:handoff (transfer capability to another node)
function handleHandoff(body: OCapNRequest): Response {
  const { from, to, target, reason, trit } = body;
  
  if (!to?.node || !to?.ip) {
    return Response.json({ error: "to.node and to.ip required" }, { status: 400 });
  }
  
  if (!target || target.index === undefined) {
    return Response.json({ error: "target.index required" }, { status: 400 });
  }
  
  const goblin = meshState.goblins[target.index];
  if (!goblin) {
    return Response.json({ error: `Goblin ${target.index} not found` }, { status: 404 });
  }
  
  if (trit !== undefined) {
    meshState.gf3Sum += trit;
  }
  
  // Record the handoff (in real implementation, would notify the target node)
  const handoffRecord = {
    from: {
      node: meshState.localNode,
      goblin: target.index,
      color: goblin.color,
    },
    to: {
      node: to.node,
      ip: to.ip,
      port: to.port || 9324,
    },
    reason: reason || 'explicit',
    timestamp: new Date().toISOString(),
  };
  
  const responseTrit: Trit = 0; // Handoff is coordinator action (ERGODIC)
  meshState.gf3Sum += responseTrit;
  
  console.log(`[OCapN] Handoff goblin-${target.index} to ${to.node}@${to.ip}`);
  
  return Response.json({
    op: "op:handoff-ack",
    handoff: handoffRecord,
    sturdyref: goblin,
    trit: responseTrit,
    gf3: {
      localSum: meshState.gf3Sum,
      balanced: meshState.gf3Sum % 3 === 0,
    },
    syrup: encode({
      tag: Symbol.for("op:handoff-ack"),
      fields: [goblin.uri, to.node, reason || 'explicit'],
    } as SyrupRecord),
  });
}

// ═══════════════════════════════════════════════════════════════
// TIME-TRAVEL OPERATION HANDLERS
// ═══════════════════════════════════════════════════════════════

// Handle op:snapshot (save current state)
function handleSnapshot(body: OCapNRequest): Response {
  const { label } = body;
  
  const snapshot = saveSnapshot(label as string | undefined);
  
  return Response.json({
    op: "op:snapshot-ack",
    snapshot: {
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      label: snapshot.label,
    },
    stats: {
      goblins: snapshot.goblins.length,
      peers: snapshot.peers.length,
      vows: snapshot.vows.length,
      listeners: snapshot.listeners.length,
      gf3Sum: snapshot.gf3Sum,
    },
    totalSnapshots: snapshots.size,
  });
}

// Handle op:restore (rewind to snapshot)
function handleRestore(body: OCapNRequest): Response {
  const { snapshotId } = body;
  
  if (!snapshotId) {
    return Response.json({ error: "snapshotId required" }, { status: 400 });
  }
  
  const snapshot = snapshots.get(snapshotId as string);
  if (!snapshot) {
    return Response.json({ 
      error: `Snapshot ${snapshotId} not found`,
      available: listSnapshots(),
    }, { status: 404 });
  }
  
  const success = restoreSnapshot(snapshotId as string);
  
  if (!success) {
    return Response.json({ error: "Restore failed" }, { status: 500 });
  }
  
  return Response.json({
    op: "op:restore-ack",
    restored: {
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      label: snapshot.label,
      age: `${((Date.now() - snapshot.timestamp) / 1000).toFixed(1)}s ago`,
    },
    currentState: {
      goblins: meshState.goblins.length,
      peers: meshState.peers.size,
      vows: meshState.vows.size,
      listeners: meshState.listeners.size,
      gf3Sum: meshState.gf3Sum,
    },
  });
}

// Handle op:snapshots (list all snapshots)
function handleSnapshots(): Response {
  const snapshotList = listSnapshots().map(s => ({
    ...s,
    age: `${((Date.now() - s.timestamp) / 1000).toFixed(1)}s ago`,
    iso: new Date(s.timestamp).toISOString(),
  }));
  
  return Response.json({
    op: "op:snapshots-ack",
    snapshots: snapshotList,
    count: snapshotList.length,
    messageLogSize: messageLog.length,
  });
}

// Handle op:replay (get messages since snapshot for replay)
function handleReplay(body: OCapNRequest): Response {
  const { snapshotId } = body;
  
  if (!snapshotId) {
    return Response.json({ error: "snapshotId required" }, { status: 400 });
  }
  
  const messages = getMessagesSince(snapshotId as string);
  
  return Response.json({
    op: "op:replay-ack",
    snapshotId,
    messages: messages.map(m => ({
      timestamp: m.timestamp,
      op: m.op,
      // Omit full body for brevity, include key identifiers
      target: (m.body as OCapNRequest).target,
      method: (m.body as OCapNRequest).method,
    })),
    count: messages.length,
  });
}

// Handle op:gc (garbage collect unused references)
function handleGC(body: OCapNRequest): Response {
  const { vowIds, listenerIds } = body;
  
  let gcVows = 0;
  let gcListeners = 0;
  
  // GC specific vows if provided, otherwise GC all fulfilled/broken vows
  if (vowIds && Array.isArray(vowIds)) {
    for (const vowId of vowIds) {
      if (meshState.vows.delete(vowId)) {
        gcVows++;
      }
    }
  } else {
    // GC resolved vows older than 5 minutes
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [id, vow] of meshState.vows) {
      if (vow.status !== 'pending' && vow.resolvedAt) {
        const resolvedTime = new Date(vow.resolvedAt).getTime();
        if (resolvedTime < cutoff) {
          meshState.vows.delete(id);
          gcVows++;
        }
      }
    }
  }
  
  // GC specific listeners if provided
  if (listenerIds && Array.isArray(listenerIds)) {
    for (const listenerId of listenerIds) {
      if (meshState.listeners.delete(listenerId)) {
        gcListeners++;
      }
    }
  }
  
  const responseTrit: Trit = -1; // GC is consumptive (-1)
  meshState.gf3Sum += responseTrit;
  
  console.log(`[OCapN] GC: ${gcVows} vows, ${gcListeners} listeners`);
  
  return Response.json({
    op: "op:gc-ack",
    collected: {
      vows: gcVows,
      listeners: gcListeners,
    },
    remaining: {
      vows: meshState.vows.size,
      listeners: meshState.listeners.size,
    },
    trit: responseTrit,
    gf3: {
      localSum: meshState.gf3Sum,
      balanced: meshState.gf3Sum % 3 === 0,
    },
  });
}

// Request body type
interface OCapNRequest {
  op: string;
  from?: { node: string; ip: string; port?: number };
  to?: { node: string; ip: string; port?: number };
  target?: { index: number; seed?: number };
  seed?: number;
  sturdyrefs?: SturdyRef[];
  trit?: Trit;
  method?: string;
  args?: unknown[];
  vowId?: string;
  result?: unknown;
  error?: string;
  events?: string[];
  reason?: string;
  vowIds?: string[];
  listenerIds?: string[];
  // Time-travel fields
  label?: string;
  snapshotId?: string;
}

// Handle OCapN operations
async function handleOCapN(req: Request): Promise<Response> {
  try {
    const body = await req.json() as OCapNRequest;
    
    console.log("[OCapN] Received:", JSON.stringify(body, null, 2));
    
    const { op } = body;
    
    // Log message for replay (skip meta-operations that don't mutate state)
    const skipLogging = ['op:snapshots', 'op:replay'].includes(op);
    if (!skipLogging) {
      messageLog.push({
        timestamp: Date.now(),
        op,
        body,
      });
    }
    
    // Route to appropriate handler
    switch (op) {
      case 'op:hello':
        return handleHello(body);
      
      case 'op:deliver':
        return handleDeliver(body);
      
      case 'op:fulfill':
        return handleFulfill(body);
      
      case 'op:break':
        return handleBreak(body);
      
      case 'op:listen':
        return handleListen(body);
      
      case 'op:handoff':
        return handleHandoff(body);
      
      case 'op:gc':
        return handleGC(body);
      
      // Time-travel operations
      case 'op:snapshot':
        return handleSnapshot(body);
      
      case 'op:restore':
        return handleRestore(body);
      
      case 'op:snapshots':
        return handleSnapshots();
      
      case 'op:replay':
        return handleReplay(body);
      
      // Legacy support for old op names
      case 'op:reply':
      case 'hello':
        return handleHello(body);
      
      default:
        return Response.json({
          error: "Unknown operation",
          op,
          supportedOps: [
            'op:hello    - Initial handshake',
            'op:deliver  - Invoke method on goblin (returns vow)',
            'op:fulfill  - Resolve a vow with value',
            'op:break    - Reject a vow with error',
            'op:listen   - Subscribe to goblin events',
            'op:handoff  - Transfer capability to another node',
            'op:gc       - Garbage collect references',
            '── Time-Travel ──',
            'op:snapshot - Save current state (label optional)',
            'op:restore  - Rewind to snapshot (snapshotId required)',
            'op:snapshots- List all snapshots',
            'op:replay   - Get messages since snapshot',
          ],
        }, { status: 400 });
    }
  } catch (error) {
    console.error("[OCapN] Error:", error);
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Request handler
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  let response: Response;
  
  switch (url.pathname) {
    case "/":
      response = handleHealth();
      break;
    case "/mesh":
      response = handleMeshStatus();
      break;
    case "/ocapn":
      if (req.method !== "POST") {
        response = Response.json({ error: "POST required" }, { status: 405 });
      } else {
        response = await handleOCapN(req);
      }
      break;
    default:
      response = Response.json({ error: "Not Found" }, { status: 404 });
  }
  
  // Add CORS headers to response
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Start server
const PORT = 9323;

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║         OCapN/CapTP Server with Time-Travel                    ║
╠═══════════════════════════════════════════════════════════════╣
║ Node:     ${meshState.localNode.padEnd(48)}║
║ Endpoint: ocapn://tailscale/${meshState.localNode}/captp:${PORT}       ║
║ Goblins:  ${String(meshState.goblins.length).padEnd(48)}║
║ Seed:     ${String(meshState.seed).padEnd(48)}║
╠═══════════════════════════════════════════════════════════════╣
║ Endpoints:                                                     ║
║   GET  /       - Health check                                  ║
║   GET  /mesh   - Full mesh status                              ║
║   POST /ocapn  - OCapN operations                              ║
╠═══════════════════════════════════════════════════════════════╣
║ Time-Travel (à la Goblins):                                    ║
║   op:snapshot  - Save transactional heap state                 ║
║   op:restore   - Rewind to any snapshot                        ║
║   op:snapshots - List all saved snapshots                      ║
║   op:replay    - Get messages since snapshot                   ║
╚═══════════════════════════════════════════════════════════════╝
`);

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`[OCapN] Listening on http://localhost:${server.port}`);
console.log(`[OCapN] Tailscale endpoint: http://${meshState.localIP}:${server.port}`);
console.log(`[OCapN] Sturdyref: ocapn://tailscale/${meshState.localNode}/captp:${server.port}`);
console.log("");
console.log("Waiting for peer connections...");
