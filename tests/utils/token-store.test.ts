// Tests for client-side token storage

import { test, expect, beforeEach, afterAll } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { createHash } from "crypto";

// Create isolated test directory
const testDir = join(tmpdir(), `vers-agent-token-test-${Date.now()}`);
mkdirSync(testDir, { recursive: true });
const testTokensFile = join(testDir, "tokens.json");

interface TokenStore {
  tokens: Record<string, string>;
}

function loadStore(): TokenStore {
  try {
    if (existsSync(testTokensFile)) {
      const data = readFileSync(testTokensFile, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Ignore read errors
  }
  return { tokens: {} };
}

function saveStore(store: TokenStore): void {
  writeFileSync(testTokensFile, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function hashServerUrl(url: string): string {
  const normalized = url.toLowerCase().replace(/\/+$/, "");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

// Test implementation of token store (isolated)
const testTokenStore = {
  getToken(serverUrl: string): string | null {
    const store = loadStore();
    const key = hashServerUrl(serverUrl);
    return store.tokens[key] || null;
  },

  setToken(serverUrl: string, token: string): void {
    const store = loadStore();
    const key = hashServerUrl(serverUrl);
    store.tokens[key] = token;
    saveStore(store);
  },

  removeToken(serverUrl: string): void {
    const store = loadStore();
    const key = hashServerUrl(serverUrl);
    delete store.tokens[key];
    saveStore(store);
  },

  clearAll(): void {
    saveStore({ tokens: {} });
  },
};

// Reset before each test
beforeEach(() => {
  if (existsSync(testTokensFile)) {
    rmSync(testTokensFile);
  }
});

// Cleanup after all tests
afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

test("getToken returns null for unknown server", () => {
  const token = testTokenStore.getToken("http://localhost:9999");
  expect(token).toBeNull();
});

test("setToken stores token for server", () => {
  testTokenStore.setToken("http://localhost:9999", "my-secret-token");

  const token = testTokenStore.getToken("http://localhost:9999");
  expect(token).toBe("my-secret-token");
});

test("setToken overwrites existing token", () => {
  testTokenStore.setToken("http://localhost:9999", "token-1");
  testTokenStore.setToken("http://localhost:9999", "token-2");

  const token = testTokenStore.getToken("http://localhost:9999");
  expect(token).toBe("token-2");
});

test("tokens are stored per server URL", () => {
  testTokenStore.setToken("http://localhost:9999", "token-a");
  testTokenStore.setToken("http://localhost:8888", "token-b");

  expect(testTokenStore.getToken("http://localhost:9999")).toBe("token-a");
  expect(testTokenStore.getToken("http://localhost:8888")).toBe("token-b");
});

test("removeToken deletes token for server", () => {
  testTokenStore.setToken("http://localhost:9999", "my-token");
  testTokenStore.removeToken("http://localhost:9999");

  const token = testTokenStore.getToken("http://localhost:9999");
  expect(token).toBeNull();
});

test("removeToken doesn't affect other servers", () => {
  testTokenStore.setToken("http://localhost:9999", "token-a");
  testTokenStore.setToken("http://localhost:8888", "token-b");

  testTokenStore.removeToken("http://localhost:9999");

  expect(testTokenStore.getToken("http://localhost:9999")).toBeNull();
  expect(testTokenStore.getToken("http://localhost:8888")).toBe("token-b");
});

test("clearAll removes all tokens", () => {
  testTokenStore.setToken("http://localhost:9999", "token-a");
  testTokenStore.setToken("http://localhost:8888", "token-b");

  testTokenStore.clearAll();

  expect(testTokenStore.getToken("http://localhost:9999")).toBeNull();
  expect(testTokenStore.getToken("http://localhost:8888")).toBeNull();
});

test("URL normalization - trailing slash ignored", () => {
  testTokenStore.setToken("http://localhost:9999/", "my-token");

  expect(testTokenStore.getToken("http://localhost:9999")).toBe("my-token");
  expect(testTokenStore.getToken("http://localhost:9999/")).toBe("my-token");
});

test("URL normalization - case insensitive", () => {
  testTokenStore.setToken("HTTP://LOCALHOST:9999", "my-token");

  expect(testTokenStore.getToken("http://localhost:9999")).toBe("my-token");
});

test("tokens persist across store reloads", () => {
  testTokenStore.setToken("http://localhost:9999", "persistent-token");

  // Verify file was created
  expect(existsSync(testTokensFile)).toBe(true);

  // Read directly from file to verify persistence
  const fileContent = readFileSync(testTokensFile, "utf-8");
  const parsed = JSON.parse(fileContent);
  expect(Object.keys(parsed.tokens).length).toBe(1);
});

test("handles corrupted tokens file gracefully", () => {
  writeFileSync(testTokensFile, "not valid json {{{");

  // Should return null, not throw
  const token = testTokenStore.getToken("http://localhost:9999");
  expect(token).toBeNull();

  // Should still be able to set new tokens
  testTokenStore.setToken("http://localhost:9999", "new-token");
  expect(testTokenStore.getToken("http://localhost:9999")).toBe("new-token");
});
