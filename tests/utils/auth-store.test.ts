// Tests for claim-based authentication store

import { test, expect, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { randomBytes, createHash } from "crypto";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";

// Create isolated test database
const testDir = join(tmpdir(), `vers-agent-test-${Date.now()}`);
mkdirSync(testDir, { recursive: true });
const testDbPath = join(testDir, "auth.db");

// Initialize test database with same schema as auth-store
const db = new Database(testDbPath);
db.run(`
  CREATE TABLE IF NOT EXISTS server_claim (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    claimed_at TEXT,
    token_hash TEXT,
    client_id TEXT
  )
`);
db.run(`
  INSERT OR IGNORE INTO server_claim (id, claimed_at, token_hash, client_id)
  VALUES (1, NULL, NULL, NULL)
`);

// Helper functions (same as auth-store.ts)
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Test implementation of auth store (isolated from real one)
const testAuthStore = {
  getClaimState() {
    const row = db.query<{ claimed_at: string | null; client_id: string | null }, []>(
      "SELECT claimed_at, client_id FROM server_claim WHERE id = 1"
    ).get();
    return {
      isClaimed: row?.claimed_at !== null,
      claimedAt: row?.claimed_at || null,
      clientId: row?.client_id || null,
    };
  },

  claim(clientId: string) {
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

  verifyToken(token: string): boolean {
    const row = db.query<{ token_hash: string | null }, []>(
      "SELECT token_hash FROM server_claim WHERE id = 1"
    ).get();
    if (!row?.token_hash) return false;
    return row.token_hash === hashToken(token);
  },

  resetClaim(): void {
    db.run(
      "UPDATE server_claim SET claimed_at = NULL, token_hash = NULL, client_id = NULL WHERE id = 1"
    );
  },
};

// Reset before each test
beforeEach(() => {
  testAuthStore.resetClaim();
});

// Cleanup after all tests
afterAll(() => {
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

test("initial state is unclaimed", () => {
  const state = testAuthStore.getClaimState();
  expect(state.isClaimed).toBe(false);
  expect(state.claimedAt).toBeNull();
  expect(state.clientId).toBeNull();
});

test("claim succeeds on unclaimed server", () => {
  const result = testAuthStore.claim("test-client");

  expect(result.success).toBe(true);
  expect(result.token).toBeDefined();
  expect(typeof result.token).toBe("string");
  expect(result.token!.length).toBeGreaterThan(20);
});

test("claim updates state correctly", () => {
  testAuthStore.claim("my-client");

  const state = testAuthStore.getClaimState();
  expect(state.isClaimed).toBe(true);
  expect(state.clientId).toBe("my-client");
  expect(state.claimedAt).toBeDefined();

  // claimedAt should be a valid ISO date
  const date = new Date(state.claimedAt!);
  expect(date.getTime()).not.toBeNaN();
});

test("second claim fails on already claimed server", () => {
  const first = testAuthStore.claim("client-1");
  expect(first.success).toBe(true);

  const second = testAuthStore.claim("client-2");
  expect(second.success).toBe(false);
  expect(second.error).toBe("Server already claimed");
  expect(second.token).toBeUndefined();
});

test("verifyToken returns true for valid token", () => {
  const result = testAuthStore.claim("test-client");
  expect(result.success).toBe(true);

  const isValid = testAuthStore.verifyToken(result.token!);
  expect(isValid).toBe(true);
});

test("verifyToken returns false for invalid token", () => {
  testAuthStore.claim("test-client");

  const isValid = testAuthStore.verifyToken("invalid-token");
  expect(isValid).toBe(false);
});

test("verifyToken returns false on unclaimed server", () => {
  const isValid = testAuthStore.verifyToken("any-token");
  expect(isValid).toBe(false);
});

test("resetClaim clears the claim state", () => {
  testAuthStore.claim("test-client");

  let state = testAuthStore.getClaimState();
  expect(state.isClaimed).toBe(true);

  testAuthStore.resetClaim();

  state = testAuthStore.getClaimState();
  expect(state.isClaimed).toBe(false);
  expect(state.claimedAt).toBeNull();
  expect(state.clientId).toBeNull();
});

test("can claim again after reset", () => {
  const first = testAuthStore.claim("client-1");
  expect(first.success).toBe(true);

  testAuthStore.resetClaim();

  const second = testAuthStore.claim("client-2");
  expect(second.success).toBe(true);
  expect(second.token).toBeDefined();

  const state = testAuthStore.getClaimState();
  expect(state.clientId).toBe("client-2");
});

test("tokens are unique per claim", () => {
  const first = testAuthStore.claim("client-1");
  const firstToken = first.token;

  testAuthStore.resetClaim();

  const second = testAuthStore.claim("client-2");
  const secondToken = second.token;

  expect(firstToken).not.toBe(secondToken);
});

test("old token invalid after reset and reclaim", () => {
  const first = testAuthStore.claim("client-1");
  const oldToken = first.token!;

  testAuthStore.resetClaim();
  testAuthStore.claim("client-2");

  const isValid = testAuthStore.verifyToken(oldToken);
  expect(isValid).toBe(false);
});
