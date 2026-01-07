// Client-side token storage
// Stores authentication tokens per server URL

import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";

// Ensure data directory exists
const dataDir = join(homedir(), ".vers-agent");
try {
  mkdirSync(dataDir, { recursive: true });
} catch {
  // Directory may already exist
}

const tokensFile = join(dataDir, "tokens.json");

interface TokenStore {
  tokens: Record<string, string>; // serverHash -> token
}

function loadStore(): TokenStore {
  try {
    if (existsSync(tokensFile)) {
      const data = readFileSync(tokensFile, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Ignore read errors
  }
  return { tokens: {} };
}

function saveStore(store: TokenStore): void {
  try {
    writeFileSync(tokensFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("[TOKEN] Failed to save token store:", err);
  }
}

// Hash server URL for storage key
function hashServerUrl(url: string): string {
  // Normalize URL (remove trailing slash, lowercase)
  const normalized = url.toLowerCase().replace(/\/+$/, "");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export const tokenStore = {
  /**
   * Get stored token for a server
   */
  getToken(serverUrl: string): string | null {
    const store = loadStore();
    const key = hashServerUrl(serverUrl);
    return store.tokens[key] || null;
  },

  /**
   * Store a token for a server
   */
  setToken(serverUrl: string, token: string): void {
    const store = loadStore();
    const key = hashServerUrl(serverUrl);
    store.tokens[key] = token;
    saveStore(store);
  },

  /**
   * Remove token for a server
   */
  removeToken(serverUrl: string): void {
    const store = loadStore();
    const key = hashServerUrl(serverUrl);
    delete store.tokens[key];
    saveStore(store);
  },

  /**
   * Get all stored server URLs and their token presence
   */
  listServers(): Array<{ url: string; hasToken: boolean }> {
    const store = loadStore();
    // We only store hashes, so we can't recover URLs
    // This is mainly for debugging
    return Object.keys(store.tokens).map((hash) => ({
      url: `(hash: ${hash})`,
      hasToken: true,
    }));
  },

  /**
   * Clear all stored tokens
   */
  clearAll(): void {
    saveStore({ tokens: {} });
  },
};
