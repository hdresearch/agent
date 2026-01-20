/**
 * Derived token utilities for per-VM authentication
 *
 * Uses HMAC-SHA256 to derive unique tokens for each VM from a master key.
 * This provides:
 * - Unique token per VM (isolation)
 * - Orchestrator can verify any VM's token without storing state
 * - Revocable by rotating master key
 * - No external dependencies
 */

import { createHmac } from "crypto";

/**
 * Derive a unique token for a VM from the master key.
 * Token = HMAC-SHA256(masterKey, "vers-vm-token:" + vmId)
 */
export function deriveVmToken(masterKey: string, vmId: string): string {
  const hmac = createHmac("sha256", masterKey);
  hmac.update(`vers-vm-token:${vmId}`);
  return hmac.digest("hex");
}

/**
 * Verify a VM's derived token.
 * Returns true if the provided token matches what we'd derive for this vmId.
 */
export function verifyVmToken(masterKey: string, vmId: string, providedToken: string): boolean {
  const expectedToken = deriveVmToken(masterKey, vmId);
  // Use timing-safe comparison
  if (expectedToken.length !== providedToken.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < expectedToken.length; i++) {
    result |= expectedToken.charCodeAt(i) ^ providedToken.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Parse a token to check if it's a derived VM token or a master key.
 * Derived tokens are 64 hex chars (256 bits), master keys vary.
 */
export function isDerivedToken(token: string): boolean {
  return /^[a-f0-9]{64}$/.test(token);
}
