import { test, expect, describe } from "bun:test";
import { deriveVmToken, verifyVmToken, isDerivedToken } from "./token-derivation";

describe("token-derivation", () => {
  const masterKey = "test-master-key-12345";
  const vmId1 = "vm-abc-123";
  const vmId2 = "vm-def-456";

  describe("deriveVmToken", () => {
    test("generates consistent tokens for same inputs", () => {
      const token1 = deriveVmToken(masterKey, vmId1);
      const token2 = deriveVmToken(masterKey, vmId1);
      expect(token1).toBe(token2);
    });

    test("generates different tokens for different VMs", () => {
      const token1 = deriveVmToken(masterKey, vmId1);
      const token2 = deriveVmToken(masterKey, vmId2);
      expect(token1).not.toBe(token2);
    });

    test("generates different tokens for different master keys", () => {
      const token1 = deriveVmToken(masterKey, vmId1);
      const token2 = deriveVmToken("different-master-key", vmId1);
      expect(token1).not.toBe(token2);
    });

    test("generates 64-character hex string", () => {
      const token = deriveVmToken(masterKey, vmId1);
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("verifyVmToken", () => {
    test("returns true for valid token", () => {
      const token = deriveVmToken(masterKey, vmId1);
      expect(verifyVmToken(masterKey, vmId1, token)).toBe(true);
    });

    test("returns false for wrong VM ID", () => {
      const token = deriveVmToken(masterKey, vmId1);
      expect(verifyVmToken(masterKey, vmId2, token)).toBe(false);
    });

    test("returns false for wrong master key", () => {
      const token = deriveVmToken(masterKey, vmId1);
      expect(verifyVmToken("wrong-key", vmId1, token)).toBe(false);
    });

    test("returns false for tampered token", () => {
      const token = deriveVmToken(masterKey, vmId1);
      const tamperedToken = token.slice(0, -1) + "0"; // Change last char
      expect(verifyVmToken(masterKey, vmId1, tamperedToken)).toBe(false);
    });
  });

  describe("isDerivedToken", () => {
    test("returns true for 64-char hex string", () => {
      const token = deriveVmToken(masterKey, vmId1);
      expect(isDerivedToken(token)).toBe(true);
    });

    test("returns false for non-hex string", () => {
      expect(isDerivedToken("not-a-hex-token")).toBe(false);
    });

    test("returns false for wrong length", () => {
      expect(isDerivedToken("abc123")).toBe(false);
      expect(isDerivedToken("a".repeat(63))).toBe(false);
      expect(isDerivedToken("a".repeat(65))).toBe(false);
    });
  });
});
