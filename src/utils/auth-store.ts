// Claim-based authentication store (SQLite)
// First client to connect claims the server, gets a token

import { Database } from "bun:sqlite";
import { randomBytes, createHash } from "crypto";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import { logStream } from "./log-stream";

// Ensure data directory exists
const dataDir = join(homedir(), ".vers-agent");
try {
  mkdirSync(dataDir, { recursive: true });
} catch {
  // Directory may already exist
}

const dbPath = join(dataDir, "auth.db");
const db = new Database(dbPath);

// Initialize schema
db.run(`
  CREATE TABLE IF NOT EXISTS server_claim (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    claimed_at TEXT,
    token_hash TEXT,
    client_id TEXT
  )
`);

// Ensure single row exists
db.run(`
  INSERT OR IGNORE INTO server_claim (id, claimed_at, token_hash, client_id)
  VALUES (1, NULL, NULL, NULL)
`);

export interface ClaimState {
  isClaimed: boolean;
  claimedAt: string | null;
  clientId: string | null;
}

export interface ClaimResult {
  success: boolean;
  token?: string;
  error?: string;
}

// Generate a secure random token
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// Hash a token for storage
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const authStore = {
  /**
   * Check if server is claimed
   */
  getClaimState(): ClaimState {
    const row = db.query<{ claimed_at: string | null; client_id: string | null }, []>(
      "SELECT claimed_at, client_id FROM server_claim WHERE id = 1"
    ).get();

    return {
      isClaimed: row?.claimed_at !== null,
      claimedAt: row?.claimed_at || null,
      clientId: row?.client_id || null,
    };
  },

  /**
   * Attempt to claim the server (first connection)
   * Returns token if successful, null if already claimed
   */
  claim(clientId: string): ClaimResult {
    const state = this.getClaimState();

    if (state.isClaimed) {
      return { success: false, error: "Server already claimed" };
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const claimedAt = new Date().toISOString();

    db.run(
      "UPDATE server_claim SET claimed_at = ?, token_hash = ?, client_id = ? WHERE id = 1",
      [claimedAt, tokenHash, clientId]
    );

    return { success: true, token };
  },

  /**
   * Verify a token
   */
  verifyToken(token: string): boolean {
    const row = db.query<{ token_hash: string | null }, []>(
      "SELECT token_hash FROM server_claim WHERE id = 1"
    ).get();

    if (!row?.token_hash) {
      return false;
    }

    const providedHash = hashToken(token);
    return row.token_hash === providedHash;
  },

  /**
   * Reset claim (for recovery)
   */
  resetClaim(): void {
    db.run(
      "UPDATE server_claim SET claimed_at = NULL, token_hash = NULL, client_id = NULL WHERE id = 1"
    );
  },

  /**
   * Get stored token hash (for admin purposes)
   */
  getTokenHash(): string | null {
    const row = db.query<{ token_hash: string | null }, []>(
      "SELECT token_hash FROM server_claim WHERE id = 1"
    ).get();
    return row?.token_hash || null;
  },
};

// Check for reset on startup
if (process.env.VERS_AGENT_RESET_CLAIM === "true") {
  logStream.info("[AUTH] Resetting server claim due to VERS_AGENT_RESET_CLAIM=true");
  authStore.resetClaim();
}
