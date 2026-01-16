// Simple API key authentication
// Uses versApiKey from config - no SQLite, no derived tokens, no claims

import { getConfig, setConfig } from "./config";
import { logStream } from "./log-stream";

/**
 * Get the stored VERS API key.
 * Checks config first, then falls back to environment variable.
 */
export function getVersApiKey(): string | null {
  const config = getConfig();
  return config.versApiKey || process.env.VERS_API_KEY || null;
}

/**
 * Set the VERS API key (persists to config).
 */
export async function setVersApiKey(apiKey: string): Promise<void> {
  await setConfig({ versApiKey: apiKey });
  logStream.info("[AUTH] VERS API key stored in config");
}

/**
 * Check if authentication is configured.
 */
export function hasAuth(): boolean {
  return getVersApiKey() !== null;
}

/**
 * Verify a provided API key matches the stored one.
 */
export function verifyApiKey(providedKey: string): boolean {
  const storedKey = getVersApiKey();
  if (!storedKey) {
    return false;
  }
  return providedKey === storedKey;
}

/**
 * Clear the stored API key.
 */
export async function clearAuth(): Promise<void> {
  await setConfig({ versApiKey: null });
  logStream.info("[AUTH] VERS API key cleared");
}

// Legacy exports for compatibility during migration
// TODO: Remove these after updating all callers
export const authStore = {
  getClaimState() {
    const hasKey = hasAuth();
    return {
      isClaimed: hasKey,
      claimedAt: hasKey ? new Date().toISOString() : null,
      clientId: hasKey ? "vers-api-key" : null,
    };
  },

  verifyToken(token: string): boolean {
    return verifyApiKey(token);
  },

  resetClaim(): void {
    // No-op for now - we don't clear the API key on server restart
    // The key persists until explicitly cleared
  },
};
