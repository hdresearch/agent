// SQLite-based session storage using bun:sqlite
// Persists session metadata across server restarts

import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

export interface StoredSession {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string;
  turns: number;
  totalCost: number;
  mode: "default" | "plan";
}

// Ensure data directory exists
const dataDir = join(homedir(), ".vers-agent");
try {
  mkdirSync(dataDir, { recursive: true });
} catch {
  // Directory may already exist
}

const dbPath = join(dataDir, "sessions.db");
const db = new Database(dbPath);

// Initialize schema
db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    turns INTEGER NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'default'
  )
`);

// Create index for sorting by last_used_at
db.run(`
  CREATE INDEX IF NOT EXISTS idx_sessions_last_used
  ON sessions(last_used_at DESC)
`);

// Session outputs table - stores full chat history state
db.run(`
  CREATE TABLE IF NOT EXISTS session_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    color TEXT,
    tool_name TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )
`);

// Index for fetching outputs by session
db.run(`
  CREATE INDEX IF NOT EXISTS idx_session_outputs_session
  ON session_outputs(session_id, seq)
`);

// Prepared statements for performance
const insertStmt = db.prepare(`
  INSERT INTO sessions (id, name, created_at, last_used_at, turns, total_cost, mode)
  VALUES ($id, $name, $createdAt, $lastUsedAt, $turns, $totalCost, $mode)
`);

const updateStmt = db.prepare(`
  UPDATE sessions
  SET name = COALESCE($name, name),
      last_used_at = $lastUsedAt,
      turns = COALESCE($turns, turns),
      total_cost = COALESCE($totalCost, total_cost),
      mode = COALESCE($mode, mode)
  WHERE id = $id
`);

const getStmt = db.prepare(`
  SELECT id, name, created_at as createdAt, last_used_at as lastUsedAt,
         turns, total_cost as totalCost, mode
  FROM sessions WHERE id = $id
`);

const listStmt = db.prepare(`
  SELECT id, name, created_at as createdAt, last_used_at as lastUsedAt,
         turns, total_cost as totalCost, mode
  FROM sessions
  ORDER BY last_used_at DESC
  LIMIT $limit
`);

const deleteStmt = db.prepare(`DELETE FROM sessions WHERE id = $id`);

const getMostRecentStmt = db.prepare(`
  SELECT id, name, created_at as createdAt, last_used_at as lastUsedAt,
         turns, total_cost as totalCost, mode
  FROM sessions
  ORDER BY last_used_at DESC
  LIMIT 1
`);

export const sessionStore = {
  /**
   * Create a new session
   */
  create(id: string, name?: string): StoredSession {
    const now = new Date().toISOString();
    const session: StoredSession = {
      id,
      name: name || null,
      createdAt: now,
      lastUsedAt: now,
      turns: 0,
      totalCost: 0,
      mode: "default",
    };

    insertStmt.run({
      $id: session.id,
      $name: session.name,
      $createdAt: session.createdAt,
      $lastUsedAt: session.lastUsedAt,
      $turns: session.turns,
      $totalCost: session.totalCost,
      $mode: session.mode,
    });

    return session;
  },

  /**
   * Get a session by ID
   */
  get(id: string): StoredSession | null {
    const row = getStmt.get({ $id: id }) as StoredSession | null;
    return row;
  },

  /**
   * Get or create a session
   */
  getOrCreate(id: string, name?: string): StoredSession {
    const existing = this.get(id);
    if (existing) {
      return existing;
    }
    return this.create(id, name);
  },

  /**
   * Update session metadata
   */
  update(id: string, updates: Partial<Omit<StoredSession, "id" | "createdAt">>): StoredSession | null {
    const now = new Date().toISOString();

    updateStmt.run({
      $id: id,
      $name: updates.name ?? null,
      $lastUsedAt: now,
      $turns: updates.turns ?? null,
      $totalCost: updates.totalCost ?? null,
      $mode: updates.mode ?? null,
    });

    return this.get(id);
  },

  /**
   * Touch a session (update lastUsedAt)
   */
  touch(id: string): void {
    const now = new Date().toISOString();
    db.run("UPDATE sessions SET last_used_at = ? WHERE id = ?", [now, id]);
  },

  /**
   * Increment turns and add to cost
   */
  recordCompletion(id: string, cost: number): void {
    const now = new Date().toISOString();
    db.run(`
      UPDATE sessions
      SET turns = turns + 1,
          total_cost = total_cost + ?,
          last_used_at = ?
      WHERE id = ?
    `, [cost, now, id]);
  },

  /**
   * Set session mode
   */
  setMode(id: string, mode: "default" | "plan"): void {
    const now = new Date().toISOString();
    db.run("UPDATE sessions SET mode = ?, last_used_at = ? WHERE id = ?", [mode, now, id]);
  },

  /**
   * List sessions, most recently used first
   */
  list(limit: number = 20): StoredSession[] {
    return listStmt.all({ $limit: limit }) as StoredSession[];
  },

  /**
   * Get the most recently used session
   */
  getMostRecent(): StoredSession | null {
    return getMostRecentStmt.get() as StoredSession | null;
  },

  /**
   * Delete a session
   */
  delete(id: string): boolean {
    const result = deleteStmt.run({ $id: id });
    return result.changes > 0;
  },

  /**
   * Rename a session
   */
  rename(id: string, name: string): StoredSession | null {
    const now = new Date().toISOString();
    db.run("UPDATE sessions SET name = ?, last_used_at = ? WHERE id = ?", [name, now, id]);
    return this.get(id);
  },
};

// ============================================================
// Session Outputs (Chat History State)
// ============================================================

export interface StoredOutput {
  id: number;
  sessionId: string;
  seq: number;
  type: string;
  content: string;
  color?: string;
  toolName?: string;
  createdAt: string;
}

export interface OutputSyncInfo {
  count: number;
  lastSeq: number;
}

// Prepared statements for outputs
const insertOutputStmt = db.prepare(`
  INSERT INTO session_outputs (session_id, seq, type, content, color, tool_name, created_at)
  VALUES ($sessionId, $seq, $type, $content, $color, $toolName, $createdAt)
`);

const getOutputsStmt = db.prepare(`
  SELECT id, session_id as sessionId, seq, type, content, color, tool_name as toolName, created_at as createdAt
  FROM session_outputs
  WHERE session_id = $sessionId
  ORDER BY seq ASC
`);

const getOutputsAfterSeqStmt = db.prepare(`
  SELECT id, session_id as sessionId, seq, type, content, color, tool_name as toolName, created_at as createdAt
  FROM session_outputs
  WHERE session_id = $sessionId AND seq > $afterSeq
  ORDER BY seq ASC
`);

const getOutputCountStmt = db.prepare(`
  SELECT COUNT(*) as count, COALESCE(MAX(seq), 0) as lastSeq
  FROM session_outputs
  WHERE session_id = $sessionId
`);

const getNextSeqStmt = db.prepare(`
  SELECT COALESCE(MAX(seq), 0) + 1 as nextSeq
  FROM session_outputs
  WHERE session_id = $sessionId
`);

const clearOutputsStmt = db.prepare(`
  DELETE FROM session_outputs WHERE session_id = $sessionId
`);

// Transaction wrapper for atomic append operations
const appendTransaction = db.transaction(
  (sessionId: string, output: { type: string; content: string; color?: string; toolName?: string }) => {
    const now = new Date().toISOString();
    const { nextSeq } = getNextSeqStmt.get({ $sessionId: sessionId }) as { nextSeq: number };

    insertOutputStmt.run({
      $sessionId: sessionId,
      $seq: nextSeq,
      $type: output.type,
      $content: output.content,
      $color: output.color || null,
      $toolName: output.toolName || null,
      $createdAt: now,
    });

    return nextSeq;
  }
);

export const sessionOutputStore = {
  /**
   * Append an output to a session's history
   * Uses a transaction to prevent race conditions with sequential numbering
   */
  append(
    sessionId: string,
    output: { type: string; content: string; color?: string; toolName?: string }
  ): number {
    return appendTransaction(sessionId, output);
  },

  /**
   * Get all outputs for a session
   */
  getAll(sessionId: string): StoredOutput[] {
    return getOutputsStmt.all({ $sessionId: sessionId }) as StoredOutput[];
  },

  /**
   * Get outputs after a specific sequence number (for sync)
   */
  getAfter(sessionId: string, afterSeq: number): StoredOutput[] {
    return getOutputsAfterSeqStmt.all({ $sessionId: sessionId, $afterSeq: afterSeq }) as StoredOutput[];
  },

  /**
   * Get sync info (count and last seq) for a session
   */
  getSyncInfo(sessionId: string): OutputSyncInfo {
    return getOutputCountStmt.get({ $sessionId: sessionId }) as OutputSyncInfo;
  },

  /**
   * Clear all outputs for a session (for /new)
   */
  clear(sessionId: string): void {
    clearOutputsStmt.run({ $sessionId: sessionId });
  },
};
