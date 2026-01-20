// Authentication for vers-agent
// Supports both master API key and derived VM tokens

import { getConfig, setConfig } from "./config";
import { logStream } from "./log-stream";

/**
 * Get the authentication token for this agent.
 * Priority:
 * 1. VERS_VM_TOKEN (derived token for VM agents)
 * 2. versApiKey from config
 * 3. VERS_API_KEY env var (master key)
 */
export function getAuthToken(): string | null {
  // VMs should use their derived token
  if (process.env.VERS_VM_TOKEN) {
    return process.env.VERS_VM_TOKEN;
  }
  // Fall back to config/env
  const config = getConfig();
  return config.versApiKey || process.env.VERS_API_KEY || null;
}

/**
 * Get the stored VERS API key (master key).
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
  return getAuthToken() !== null;
}

/**
 * Verify a provided token matches our auth token.
 * Works with both master keys and derived VM tokens.
 */
export function verifyApiKey(providedKey: string): boolean {
  const storedToken = getAuthToken();
  if (!storedToken) {
    return false;
  }
  // Use timing-safe comparison
  if (storedToken.length !== providedKey.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < storedToken.length; i++) {
    result |= storedToken.charCodeAt(i) ^ providedKey.charCodeAt(i);
  }
  return result === 0;
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
