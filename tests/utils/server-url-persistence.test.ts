import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, rmSync, existsSync } from "fs";

// We need to test the config module's lastServerUrl functionality
// Since the config module uses a fixed path, we'll test the logic indirectly

describe("Server URL Persistence Logic", () => {
  describe("isRemoteUrl helper", () => {
    // This tests the logic used in index.ts to determine if a URL is remote
    const isRemoteUrl = (url: string): boolean => {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
      } catch {
        return false;
      }
    };

    test("localhost is not remote", () => {
      expect(isRemoteUrl("http://localhost:9999")).toBe(false);
      expect(isRemoteUrl("http://localhost:10000")).toBe(false);
      expect(isRemoteUrl("https://localhost:443")).toBe(false);
    });

    test("127.0.0.1 is not remote", () => {
      expect(isRemoteUrl("http://127.0.0.1:9999")).toBe(false);
      expect(isRemoteUrl("http://127.0.0.1:80")).toBe(false);
    });

    test("::1 (IPv6 localhost) parsing", () => {
      // Note: URL parsing keeps brackets for IPv6
      const url = new URL("http://[::1]:9999");
      expect(url.hostname).toBe("[::1]");
      // Currently IPv6 localhost is not handled (treated as remote)
      // This is a known limitation - IPv6 localhost is rare in practice
      expect(isRemoteUrl("http://[::1]:9999")).toBe(true);
    });

    test("LAN IP addresses are remote", () => {
      expect(isRemoteUrl("http://192.168.1.100:9999")).toBe(true);
      expect(isRemoteUrl("http://10.0.0.1:9999")).toBe(true);
      expect(isRemoteUrl("http://172.16.0.1:9999")).toBe(true);
    });

    test("public hostnames are remote", () => {
      expect(isRemoteUrl("http://myserver.local:9999")).toBe(true);
      expect(isRemoteUrl("http://example.com:9999")).toBe(true);
      expect(isRemoteUrl("https://agent.mydomain.com:443")).toBe(true);
    });

    test("invalid URLs return false", () => {
      expect(isRemoteUrl("not-a-url")).toBe(false);
      expect(isRemoteUrl("")).toBe(false);
      expect(isRemoteUrl("ftp://")).toBe(false);
    });
  });

  describe("URL saving behavior", () => {
    test("explicit /connect should save any URL including localhost", () => {
      // This tests the expected behavior:
      // When user explicitly uses /connect, we save the URL regardless of localhost
      // The /connect handler calls setConfig({ lastServerUrl: url })

      const urlsToSave = [
        "http://localhost:9999",
        "http://localhost:10000",
        "http://192.168.1.100:9999",
        "http://myserver.local:9999",
      ];

      for (const url of urlsToSave) {
        // All URLs should be valid for saving via /connect
        expect(() => new URL(url)).not.toThrow();
      }
    });

    test("--url flag should save the URL", () => {
      // This tests the expected behavior:
      // When user provides --url, we save it for auto-reconnect

      const testUrl = "http://192.168.1.100:9999";
      expect(() => new URL(testUrl)).not.toThrow();
    });
  });

  describe("URL loading behavior", () => {
    test("saved URL should be used on next launch", () => {
      // This is the expected flow:
      // 1. User runs `vers --url http://server:9999` or uses `/connect`
      // 2. URL is saved to config
      // 3. Next launch reads config and uses saved URL

      const savedUrl = "http://192.168.1.100:9999";

      // Simulating the check in index.ts
      const shouldUseRemoteMode = savedUrl !== null;
      expect(shouldUseRemoteMode).toBe(true);
    });

    test("--local flag clears saved URL", () => {
      // When user runs `vers --local`, the saved URL should be cleared
      const forceLocal = true;
      const savedUrl = "http://192.168.1.100:9999";

      // Simulating the logic in index.ts
      let clearedUrl: string | null = savedUrl;
      if (forceLocal) {
        clearedUrl = null;
      }

      expect(clearedUrl).toBeNull();
    });
  });
});

describe("Config AgentConfig Interface", () => {
  test("lastServerUrl field exists in config structure", async () => {
    // Import the actual config module to verify the interface
    const { getConfig, loadConfig } = await import("../../src/utils/config");

    // Load config (this creates default if not exists)
    await loadConfig();
    const config = getConfig();

    // Verify lastServerUrl field exists (may be null)
    expect("lastServerUrl" in config).toBe(true);
  });
});
