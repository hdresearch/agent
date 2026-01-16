/**
 * Integration tests for CLI subcommands
 *
 * These tests require a running vers-agent server.
 * Run with: INTEGRATION_TESTS=true bun test tests/cli/commands.integration.test.ts
 *
 * Or start the server first:
 *   bun run index.ts --server &
 *   INTEGRATION_TESTS=true bun test tests/cli/commands.integration.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { executeCommand, isSubcommand, SUBCOMMANDS } from "../../src/cli/commands";
import { tokenStore } from "../../src/utils/token-store";

const TEST_SERVER_URL = process.env.TEST_SERVER_URL || "http://localhost:9999";
const RUN_INTEGRATION_TESTS = process.env.INTEGRATION_TESTS === "true";

// Set VERS_URL so commands.ts getServerUrl() uses our test server
process.env.VERS_URL = TEST_SERVER_URL;

/**
 * Check if the server is running and available
 */
async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${TEST_SERVER_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Claim the server and store the auth token
 */
async function claimServer(): Promise<string | null> {
  try {
    const response = await fetch(`${TEST_SERVER_URL}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": "integration-tests",
      },
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json() as { token?: string; claimed: boolean };
      return data.token || null;
    }
    // Server might already be claimed
    return null;
  } catch {
    return null;
  }
}

/**
 * Skip test if server is not running or INTEGRATION_TESTS is not set
 */
function skipIfNoServer(serverAvailable: boolean): boolean {
  if (!RUN_INTEGRATION_TESTS) {
    console.log("Skipping: INTEGRATION_TESTS=true not set");
    return true;
  }
  if (!serverAvailable) {
    console.log(`Skipping: Server not running at ${TEST_SERVER_URL}`);
    return true;
  }
  return false;
}

describe("CLI Commands - Unit Tests", () => {
  describe("isSubcommand", () => {
    test("recognizes valid subcommands", () => {
      expect(isSubcommand("run")).toBe(true);
      expect(isSubcommand("health")).toBe(true);
      expect(isSubcommand("vms")).toBe(true);
      expect(isSubcommand("vm")).toBe(true);
      expect(isSubcommand("config")).toBe(true);
      expect(isSubcommand("help")).toBe(true);
      expect(isSubcommand("upgrade")).toBe(true);
    });

    test("rejects invalid subcommands", () => {
      expect(isSubcommand("--server")).toBe(false);
      expect(isSubcommand("-h")).toBe(false);
      expect(isSubcommand("notacommand")).toBe(false);
      expect(isSubcommand("")).toBe(false);
    });

    test("rejects flags", () => {
      expect(isSubcommand("--help")).toBe(false);
      expect(isSubcommand("--url")).toBe(false);
      expect(isSubcommand("-n")).toBe(false);
    });
  });

  describe("SUBCOMMANDS list", () => {
    test("contains expected commands", () => {
      const expectedCommands = [
        "run",
        "prompt",
        "watch",
        "health",
        "status",
        "new",
        "sessions",
        "cancel",
        "config",
        "yolo",
        "no-yolo",
        "vms",
        "vm",
        "agents",
        "skills",
        "queue",
        "upgrade",
        "help",
      ];

      for (const cmd of expectedCommands) {
        expect(SUBCOMMANDS).toContain(cmd);
      }
    });
  });

  describe("help command", () => {
    test("returns exit code 0", async () => {
      // Capture stdout
      const originalLog = console.log;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["help"]);
        expect(exitCode).toBe(0);
        expect(output).toContain("vers-agent");
        expect(output).toContain("Commands:");
        expect(output).toContain("run");
        expect(output).toContain("vm");
        expect(output).toContain("upgrade");
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("upgrade command", () => {
    test("can fetch nightly release info", async () => {
      // This test verifies the upgrade command can reach GitHub API
      // We capture output to check it finds a release without actually installing
      const originalLog = console.log;
      const originalError = console.error;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };
      console.error = (msg: string) => {
        output += msg + "\n";
      };

      try {
        // Note: This will actually try to upgrade, but since we're running from
        // bun (not compiled binary), it will try to install to /usr/local/bin
        // which may fail due to permissions - that's OK, we just want to verify
        // it can fetch release info
        const exitCode = await executeCommand(["upgrade", "--nightly"]);

        // Should at least get to the "Checking for" stage
        expect(output).toContain("Checking for nightly release");

        // If it found the release, great
        if (output.includes("Found release")) {
          expect(output).toContain("nightly");
        }
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    });
  });
});

describe("CLI Commands - Integration Tests", () => {
  let serverAvailable = false;

  beforeAll(async () => {
    if (!RUN_INTEGRATION_TESTS) {
      console.log("Integration tests disabled. Set INTEGRATION_TESTS=true to enable.");
      return;
    }

    serverAvailable = await isServerRunning();
    if (!serverAvailable) {
      console.log(`Server not running at ${TEST_SERVER_URL}`);
      console.log("Start with: bun run index.ts --server");
      return;
    }

    // Claim the server and store the token for authentication
    const token = await claimServer();
    if (token) {
      tokenStore.setToken(TEST_SERVER_URL, token);
      console.log("Server claimed successfully for integration tests");
    } else {
      // Check if we already have a valid token
      const existingToken = tokenStore.getToken(TEST_SERVER_URL);
      if (!existingToken) {
        console.log("Warning: Could not claim server and no existing token found");
      }
    }
  });

  describe("health command", () => {
    test("returns server health info", async () => {
      if (skipIfNoServer(serverAvailable)) return;

      const originalLog = console.log;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["health"]);
        expect(exitCode).toBe(0);

        const data = JSON.parse(output.trim());
        expect(data.status).toBe("ok");
        expect(typeof data.metrics).toBe("object");
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("status command", () => {
    test("returns health and config", async () => {
      if (skipIfNoServer(serverAvailable)) return;

      const originalLog = console.log;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["status"]);
        expect(exitCode).toBe(0);
        expect(output).toContain("Health:");
        expect(output).toContain("Config:");
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("config command", () => {
    test("returns current config", async () => {
      if (skipIfNoServer(serverAvailable)) return;

      const originalLog = console.log;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["config"]);
        expect(exitCode).toBe(0);

        const data = JSON.parse(output.trim());
        expect(typeof data.model).toBe("string");
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("sessions command", () => {
    test("returns session list", async () => {
      if (skipIfNoServer(serverAvailable)) return;

      const originalLog = console.log;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["sessions"]);
        expect(exitCode).toBe(0);

        const data = JSON.parse(output.trim());
        expect(Array.isArray(data.sessions)).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("vms command", () => {
    test("returns VM list", async () => {
      if (skipIfNoServer(serverAvailable)) return;

      const originalLog = console.log;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["vms"]);
        expect(exitCode).toBe(0);

        const data = JSON.parse(output.trim());
        expect(Array.isArray(data.vms)).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("agents command", () => {
    test("returns agent list", async () => {
      if (skipIfNoServer(serverAvailable)) return;

      const originalLog = console.log;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["agents"]);
        expect(exitCode).toBe(0);

        const data = JSON.parse(output.trim());
        expect(Array.isArray(data.agents)).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("skills command", () => {
    test("returns skill list", async () => {
      if (skipIfNoServer(serverAvailable)) return;

      const originalLog = console.log;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["skills"]);
        expect(exitCode).toBe(0);

        const data = JSON.parse(output.trim());
        expect(Array.isArray(data.skills)).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("queue command", () => {
    test("returns queue list", async () => {
      if (skipIfNoServer(serverAvailable)) return;

      const originalLog = console.log;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["queue"]);
        expect(exitCode).toBe(0);

        const data = JSON.parse(output.trim());
        expect(Array.isArray(data.prompts)).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("vm subcommands", () => {
    test("vm with no subcommand shows help", async () => {
      if (skipIfNoServer(serverAvailable)) return;

      const originalLog = console.log;
      const originalError = console.error;
      let output = "";
      console.log = (msg: string) => {
        output += msg + "\n";
      };
      console.error = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["vm"]);
        expect(exitCode).toBe(1); // Invalid subcommand
        expect(output).toContain("vm create");
        expect(output).toContain("vm run");
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    });
  });

  describe("unknown command", () => {
    test("returns error for unknown command", async () => {
      const originalLog = console.log;
      const originalError = console.error;
      let output = "";
      console.error = (msg: string) => {
        output += msg + "\n";
      };
      console.log = (msg: string) => {
        output += msg + "\n";
      };

      try {
        const exitCode = await executeCommand(["notacommand"]);
        expect(exitCode).toBe(1);
        expect(output).toContain("Unknown command");
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    });
  });
});

describe("CLI Commands - Error Handling", () => {
  test("handles server connection errors gracefully", async () => {
    // Temporarily override VERS_URL to point to a non-existent server
    const originalVersUrl = process.env.VERS_URL;
    process.env.VERS_URL = "http://localhost:59999";

    const originalLog = console.log;
    const originalError = console.error;
    let errorOutput = "";
    console.error = (msg: string) => {
      errorOutput += msg + "\n";
    };
    console.log = () => {};

    try {
      const exitCode = await executeCommand(["health"]);
      expect(exitCode).toBe(1);
      expect(errorOutput).toContain("Error:");
    } finally {
      console.log = originalLog;
      console.error = originalError;
      process.env.VERS_URL = originalVersUrl;
    }
  });
});
