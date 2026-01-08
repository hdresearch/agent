import { describe, test, expect, afterEach } from "bun:test";
import { createHttpServer } from "../../src/server/http-server";

describe("Port Auto-Finding", () => {
  const servers: Array<{ close: () => void }> = [];

  afterEach(() => {
    // Clean up all servers
    for (const server of servers) {
      try {
        server.close();
      } catch {
        // Ignore close errors
      }
    }
    servers.length = 0;
  });

  test("creates server on requested port when available", () => {
    // Use a high port that's likely free
    const requestedPort = 19999;
    const server = createHttpServer(requestedPort);
    servers.push(server);

    expect(server.port).toBe(requestedPort);
  });

  test("finds alternate port when requested port is in use", () => {
    const requestedPort = 19998;

    // Create first server on the port
    const server1 = createHttpServer(requestedPort);
    servers.push(server1);
    expect(server1.port).toBe(requestedPort);

    // Create second server - should find alternate port
    const server2 = createHttpServer(requestedPort);
    servers.push(server2);

    // Second server should be on a different port
    expect(server2.port).not.toBe(requestedPort);
    expect(server2.port).toBeGreaterThan(requestedPort);
  });

  test("returns actual port used", () => {
    const requestedPort = 19997;

    // Occupy a few ports
    const server1 = createHttpServer(requestedPort);
    servers.push(server1);
    const server2 = createHttpServer(requestedPort);
    servers.push(server2);
    const server3 = createHttpServer(requestedPort);
    servers.push(server3);

    // Each should have a unique port
    const ports = [server1.port, server2.port, server3.port];
    const uniquePorts = new Set(ports);
    expect(uniquePorts.size).toBe(3);
  });

  test("server.port matches actual listening port", async () => {
    const requestedPort = 19996;
    const server = createHttpServer(requestedPort);
    servers.push(server);

    // Try to connect to verify the port is correct
    const response = await fetch(`http://localhost:${server.port}/health`);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  test("throws error after max attempts", () => {
    const requestedPort = 19995;

    // Occupy many ports
    for (let i = 0; i < 10; i++) {
      const server = createHttpServer(requestedPort);
      servers.push(server);
    }

    // 11th attempt should fail (maxAttempts defaults to 10)
    expect(() => {
      const server = createHttpServer(requestedPort);
      servers.push(server);
    }).toThrow(/Could not find an available port/);
  });
});

describe("Server Health Check", () => {
  let server: { close: () => void; port: number } | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  test("health endpoint returns status", async () => {
    server = createHttpServer(19994);

    const response = await fetch(`http://localhost:${server.port}/health`);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data.status).toBe("ok");
    expect(typeof data.claimed).toBe("boolean");
  });
});
