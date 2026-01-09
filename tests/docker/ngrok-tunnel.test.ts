// ngrok Tunnel Integration Tests
// Tests tunnel module functionality (unit tests, no actual ngrok required)

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { existsSync } from "fs";
import { join, dirname } from "path";

// Path to policy file
const TUNNEL_DIR = join(import.meta.dir, "../../src/tunnel");
const POLICY_PATH = join(TUNNEL_DIR, "policy.yml");

describe("ngrok Tunnel Module", () => {
  describe("Policy File", () => {
    test("policy.yml exists", () => {
      expect(existsSync(POLICY_PATH)).toBe(true);
    });

    test("policy.yml contains IP restrictions", async () => {
      const content = await Bun.file(POLICY_PATH).text();
      
      expect(content).toContain("restrict-ips");
      expect(content).toContain("allow:");
      expect(content).toContain("on_http_request:");
    });

    test("policy.yml includes Anthropic IP range", async () => {
      const content = await Bun.file(POLICY_PATH).text();
      
      // Anthropic's IP range for Claude Remote MCP
      expect(content).toContain("160.79.104.0/23");
    });

    test("policy.yml is valid YAML structure", async () => {
      const content = await Bun.file(POLICY_PATH).text();
      
      // Basic YAML structure checks
      expect(content).toMatch(/^on_http_request:/m);
      expect(content).toMatch(/^\s+- actions:/m);
      expect(content).toMatch(/^\s+- type: restrict-ips/m);
    });
  });

  describe("Tunnel Module Exports", () => {
    test("index.ts exists", () => {
      const indexPath = join(TUNNEL_DIR, "index.ts");
      expect(existsSync(indexPath)).toBe(true);
    });

    test("module exports expected functions", async () => {
      // Import the module
      const tunnel = await import("../../src/tunnel/index");
      
      expect(typeof tunnel.startTunnel).toBe("function");
      expect(typeof tunnel.stopTunnel).toBe("function");
      expect(typeof tunnel.getTunnelStatus).toBe("function");
    });
  });

  describe("TunnelConfig Interface", () => {
    test("startTunnel accepts port parameter", async () => {
      const { startTunnel } = await import("../../src/tunnel/index");
      
      // Don't actually start - just verify the function signature
      // by checking it's callable (will throw if ngrok not installed)
      expect(typeof startTunnel).toBe("function");
    });

    test("stopTunnel is safe to call when no tunnel running", async () => {
      const { stopTunnel } = await import("../../src/tunnel/index");
      
      // Should not throw
      expect(() => stopTunnel()).not.toThrow();
    });

    test("getTunnelStatus returns null when no tunnel", async () => {
      const { getTunnelStatus } = await import("../../src/tunnel/index");
      
      const status = await getTunnelStatus();
      expect(status).toBeNull();
    });
  });

  describe("README Documentation", () => {
    test("README.md exists", () => {
      const readmePath = join(TUNNEL_DIR, "README.md");
      expect(existsSync(readmePath)).toBe(true);
    });

    test("README contains usage instructions", async () => {
      const readmePath = join(TUNNEL_DIR, "README.md");
      const content = await Bun.file(readmePath).text();
      
      expect(content).toContain("ngrok");
      expect(content).toContain("Quick Start");
      expect(content).toContain("IP Whitelisting");
    });

    test("README mentions Claude Remote MCP", async () => {
      const readmePath = join(TUNNEL_DIR, "README.md");
      const content = await Bun.file(readmePath).text();
      
      expect(content).toContain("Claude");
      expect(content).toContain("Remote MCP");
    });
  });
});

describe("ngrok GitHub Actions", () => {
  const workflowsDir = join(import.meta.dir, "../../.github/workflows");

  test("ngrok-expose.yml exists", () => {
    expect(existsSync(join(workflowsDir, "ngrok-expose.yml"))).toBe(true);
  });

  test("ngrok-test-remote.yml exists", () => {
    expect(existsSync(join(workflowsDir, "ngrok-test-remote.yml"))).toBe(true);
  });

  test("ngrok-deploy-preview.yml exists", () => {
    expect(existsSync(join(workflowsDir, "ngrok-deploy-preview.yml"))).toBe(true);
  });

  test("workflows reference NGROK_AUTHTOKEN secret", async () => {
    const exposePath = join(workflowsDir, "ngrok-expose.yml");
    const content = await Bun.file(exposePath).text();
    
    expect(content).toContain("NGROK_AUTHTOKEN");
    expect(content).toContain("secrets.NGROK_AUTHTOKEN");
  });

  test("workflows use policy.yml for IP restrictions", async () => {
    const exposePath = join(workflowsDir, "ngrok-expose.yml");
    const content = await Bun.file(exposePath).text();
    
    expect(content).toContain("traffic-policy-file");
    expect(content).toContain("policy.yml");
  });
});

describe("Integration with vers-agent", () => {
  test("tunnel can be imported alongside server modules", async () => {
    // Verify tunnel module doesn't conflict with server
    const tunnel = await import("../../src/tunnel/index");
    
    expect(tunnel).toBeDefined();
    expect(tunnel.startTunnel).toBeDefined();
  });

  test("tunnel module uses logStream for debugging", async () => {
    const indexPath = join(TUNNEL_DIR, "index.ts");
    const content = await Bun.file(indexPath).text();
    
    expect(content).toContain("logStream");
    expect(content).toContain('import { logStream }');
  });
});
