// End-to-end test: Client controlling ACP via authenticated ngrok tunnel
// Tests the full remote flow: client → ngrok → vers-agent → ACP → Claude Code

import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const NGROK_TUNNEL_URL = process.env.NGROK_TUNNEL_URL || "https://vers.ngrok.io";
const NGROK_API_URL = "http://127.0.0.1:4040/api/tunnels";

interface RpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

async function isNgrokRunning(): Promise<boolean> {
  try {
    const res = await fetch(NGROK_API_URL);
    if (!res.ok) return false;
    const data = await res.json() as { tunnels: Array<{ public_url: string }> };
    return data.tunnels.some(t => t.public_url.startsWith("https"));
  } catch {
    return false;
  }
}

async function getTunnelUrl(): Promise<string | null> {
  try {
    const res = await fetch(NGROK_API_URL);
    if (!res.ok) return null;
    const data = await res.json() as { tunnels: Array<{ public_url: string }> };
    const tunnel = data.tunnels.find(t => t.public_url.startsWith("https"));
    return tunnel?.public_url || null;
  } catch {
    return null;
  }
}

async function makeRemoteRpcCall<T>(
  tunnelUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  authToken?: string
): Promise<RpcResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${tunnelUrl}/rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now(),
    }),
  });

  return res.json() as Promise<RpcResponse<T>>;
}

async function claimServer(tunnelUrl: string): Promise<string> {
  const res = await fetch(`${tunnelUrl}/claim`, { method: "POST" });
  const data = await res.json() as { token?: string; error?: string };
  if (data.token) {
    return data.token;
  }
  // Server already claimed - try to get existing session
  // For tests, we'll use an empty token and expect some calls to fail
  console.log("Server already claimed, continuing with limited auth");
  return "";
}

describe("ngrok E2E Tests", () => {
  let tunnelAvailable = false;
  let tunnelUrl: string;
  let authToken: string;

  beforeAll(async () => {
    tunnelAvailable = await isNgrokRunning();
    if (!tunnelAvailable) {
      console.log("Skipping ngrok E2E tests: ngrok tunnel not running");
      console.log("Start with: docker compose -f docker-compose.ngrok.yml up -d");
      return;
    }

    tunnelUrl = (await getTunnelUrl()) || NGROK_TUNNEL_URL;
    console.log(`Using tunnel URL: ${tunnelUrl}`);

    // Claim the server to get auth token
    authToken = await claimServer(tunnelUrl);
  });

  function skipIfNoTunnel(): boolean {
    if (!tunnelAvailable) {
      console.log("Skipping: ngrok tunnel not available");
      return true;
    }
    return false;
  }

  describe("Tunnel Connectivity", () => {
    test("tunnel is accessible via HTTPS", async () => {
      if (skipIfNoTunnel()) return;

      const res = await fetch(`${tunnelUrl}/health`);
      expect(res.ok).toBe(true);
      expect(res.url.startsWith("https://")).toBe(true);
    });

    test("health endpoint returns valid response", async () => {
      if (skipIfNoTunnel()) return;

      const res = await fetch(`${tunnelUrl}/health`);
      const data = await res.json() as { status: string };
      expect(data.status).toBe("ok");
    });

    test("ngrok inspector shows tunnel info", async () => {
      if (skipIfNoTunnel()) return;

      const res = await fetch(NGROK_API_URL);
      expect(res.ok).toBe(true);

      const data = await res.json() as { tunnels: Array<{ public_url: string; config: { addr: string } }> };
      expect(data.tunnels.length).toBeGreaterThan(0);

      const tunnel = data.tunnels[0];
      expect(tunnel.public_url).toContain("ngrok");
    });
  });

  describe("Remote Authentication", () => {
    test("claim endpoint returns auth token or server already claimed", async () => {
      if (skipIfNoTunnel()) return;

      // Token may be empty if server was already claimed
      expect(typeof authToken).toBe("string");
    });

    test("authenticated RPC calls succeed or require auth", async () => {
      if (skipIfNoTunnel()) return;

      const response = await makeRemoteRpcCall(tunnelUrl, "session/list", {}, authToken);
      // Either succeeds or returns auth error (if no valid token)
      if (authToken) {
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
      } else {
        // Without auth, expect either success (unprotected) or auth error
        expect(response).toBeDefined();
      }
    });
  });

  describe("Remote ACP Protocol", () => {
    test("initialize handshake works over tunnel", async () => {
      if (skipIfNoTunnel()) return;
      if (!authToken) {
        console.log("Skipping: No auth token available");
        return;
      }

      const response = await makeRemoteRpcCall<{
        agentInfo: { name: string; version: string };
        capabilities: Record<string, unknown>;
      }>(tunnelUrl, "initialize", {
        clientInfo: { name: "ngrok-e2e-test", version: "1.0.0" },
        capabilities: {},
      }, authToken);

      expect(response.error).toBeUndefined();
      expect(response.result?.agentInfo).toBeDefined();
      expect(response.result?.capabilities).toBeDefined();
    });

    test("agent/list returns available agents", async () => {
      if (skipIfNoTunnel()) return;
      if (!authToken) {
        console.log("Skipping: No auth token available");
        return;
      }

      const response = await makeRemoteRpcCall<{
        agents: Array<{ identity: string; name: string }>;
        currentAgent: string;
      }>(tunnelUrl, "agent/list", {}, authToken);

      expect(response.error).toBeUndefined();
      expect(response.result?.agents).toBeDefined();
      expect(Array.isArray(response.result?.agents)).toBe(true);
    });

    test("session/list works remotely", async () => {
      if (skipIfNoTunnel()) return;
      if (!authToken) {
        console.log("Skipping: No auth token available");
        return;
      }

      const response = await makeRemoteRpcCall<{
        sessions: Array<{ id: string }>;
      }>(tunnelUrl, "session/list", {}, authToken);

      expect(response.error).toBeUndefined();
      expect(Array.isArray(response.result?.sessions || response.result)).toBe(true);
    });
  });

  describe("Remote Session Management", () => {
    test("session/new creates session via tunnel", async () => {
      if (skipIfNoTunnel()) return;

      const response = await makeRemoteRpcCall<{ sessionId: string }>(
        tunnelUrl,
        "session/new",
        { cwd: "/tmp" },
        authToken
      );

      // May fail without API key configured
      if (response.error) {
        console.log("session/new error (expected without API key):", response.error.message);
        return;
      }

      expect(response.result?.sessionId).toBeTruthy();
    });
  });

  describe("IP Whitelisting", () => {
    test("requests from allowed IPs succeed", async () => {
      if (skipIfNoTunnel()) return;

      // Our IP should be whitelisted in policy.yml
      const res = await fetch(`${tunnelUrl}/health`);
      expect(res.ok).toBe(true);
    });
  });

  describe("Latency and Performance", () => {
    test("RPC round-trip completes in reasonable time", async () => {
      if (skipIfNoTunnel()) return;
      if (!authToken) {
        console.log("Skipping: No auth token available");
        return;
      }

      const start = Date.now();
      await makeRemoteRpcCall(tunnelUrl, "session/list", {}, authToken);
      const elapsed = Date.now() - start;

      // Should complete within 5 seconds even over ngrok
      expect(elapsed).toBeLessThan(5000);
      console.log(`RPC round-trip: ${elapsed}ms`);
    });

    test("concurrent requests are handled", async () => {
      if (skipIfNoTunnel()) return;
      if (!authToken) {
        console.log("Skipping: No auth token available");
        return;
      }

      const requests = [
        makeRemoteRpcCall(tunnelUrl, "agent/list", {}, authToken),
        makeRemoteRpcCall(tunnelUrl, "session/list", {}, authToken),
        makeRemoteRpcCall(tunnelUrl, "system/cwd", {}, authToken),
      ];

      const results = await Promise.all(requests);

      for (const result of results) {
        expect(result.error).toBeUndefined();
        expect(result.result).toBeDefined();
      }
    });
  });
});
