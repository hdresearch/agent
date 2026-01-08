import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";

// Test config persistence
describe("Config Persistence", () => {
  const CONFIG_DIR = join(homedir(), ".vers");
  const CONFIG_FILE = join(CONFIG_DIR, "agent_config.json");
  let originalConfig: string | null = null;

  beforeEach(() => {
    // Backup original config if it exists
    if (existsSync(CONFIG_FILE)) {
      originalConfig = readFileSync(CONFIG_FILE, "utf-8");
    }
  });

  afterEach(async () => {
    // Restore original config
    if (originalConfig !== null) {
      writeFileSync(CONFIG_FILE, originalConfig);
    }
  });

  describe("lastServerUrl", () => {
    test("setConfig saves lastServerUrl to file", async () => {
      const { setConfig, loadConfig, getConfig } = await import("../../src/utils/config");

      // Load config first
      await loadConfig();

      // Set a server URL
      await setConfig({ lastServerUrl: "http://192.168.1.100:9999" });

      // Read the file directly to verify
      const fileContent = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(fileContent);

      expect(parsed.lastServerUrl).toBe("http://192.168.1.100:9999");
    });

    test("getConfig returns saved lastServerUrl", async () => {
      const { setConfig, loadConfig, getConfig } = await import("../../src/utils/config");

      await loadConfig();
      await setConfig({ lastServerUrl: "http://myserver.local:9999" });

      const config = getConfig();
      expect(config.lastServerUrl).toBe("http://myserver.local:9999");
    });

    test("setConfig with null clears lastServerUrl", async () => {
      const { setConfig, loadConfig, getConfig } = await import("../../src/utils/config");

      await loadConfig();

      // Set a URL first
      await setConfig({ lastServerUrl: "http://example.com:9999" });
      expect(getConfig().lastServerUrl).toBe("http://example.com:9999");

      // Clear it
      await setConfig({ lastServerUrl: null });
      expect(getConfig().lastServerUrl).toBeNull();

      // Verify file
      const fileContent = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(fileContent);
      expect(parsed.lastServerUrl).toBeNull();
    });

    test("localhost URLs can be saved", async () => {
      const { setConfig, loadConfig, getConfig } = await import("../../src/utils/config");

      await loadConfig();

      // localhost URLs should be saveable (for Docker containers, etc.)
      await setConfig({ lastServerUrl: "http://localhost:9999" });
      expect(getConfig().lastServerUrl).toBe("http://localhost:9999");
    });

    test("config survives reload", async () => {
      // This simulates app restart
      const configModule1 = await import("../../src/utils/config");

      await configModule1.loadConfig();
      await configModule1.setConfig({ lastServerUrl: "http://test.server:9999" });

      // Clear the module cache to simulate restart
      // Note: In real tests we'd need to clear the module cache
      // For now, just verify the file was written
      const fileContent = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(fileContent);
      expect(parsed.lastServerUrl).toBe("http://test.server:9999");
    });
  });

  describe("other config fields preserved", () => {
    test("setting lastServerUrl preserves model and thinkingBudget", async () => {
      const { setConfig, loadConfig, getConfig } = await import("../../src/utils/config");

      await loadConfig();

      // Set model first
      await setConfig({ model: "haiku", thinkingBudget: 5000 });

      // Now set lastServerUrl
      await setConfig({ lastServerUrl: "http://server:9999" });

      // Verify all fields
      const config = getConfig();
      expect(config.model).toBe("haiku");
      expect(config.thinkingBudget).toBe(5000);
      expect(config.lastServerUrl).toBe("http://server:9999");
    });
  });
});

describe("URL Edge Cases", () => {
  test("URLs with different ports", async () => {
    const { setConfig, loadConfig, getConfig } = await import("../../src/utils/config");

    await loadConfig();

    const testUrls = [
      "http://localhost:80",
      "http://localhost:443",
      "http://localhost:9999",
      "http://localhost:10000",
      "http://192.168.1.1:8080",
    ];

    for (const url of testUrls) {
      await setConfig({ lastServerUrl: url });
      expect(getConfig().lastServerUrl).toBe(url);
    }
  });

  test("URLs with different protocols", async () => {
    const { setConfig, loadConfig, getConfig } = await import("../../src/utils/config");

    await loadConfig();

    await setConfig({ lastServerUrl: "http://server:9999" });
    expect(getConfig().lastServerUrl).toBe("http://server:9999");

    await setConfig({ lastServerUrl: "https://server:9999" });
    expect(getConfig().lastServerUrl).toBe("https://server:9999");
  });

  test("URLs with hostnames", async () => {
    const { setConfig, loadConfig, getConfig } = await import("../../src/utils/config");

    await loadConfig();

    const testUrls = [
      "http://myserver.local:9999",
      "http://agent.home.lan:9999",
      "http://192.168.1.100:9999",
      "http://10.0.0.1:9999",
    ];

    for (const url of testUrls) {
      await setConfig({ lastServerUrl: url });
      expect(getConfig().lastServerUrl).toBe(url);
    }
  });
});
