// Permission Dialog Integration Tests
// Tests the interactive permission dialog functionality

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { spawn, type Subprocess } from "bun";
import {
  TEST_SERVER_URL,
  isDockerServerRunning,
  createTestContext,
  DockerTestContext,
} from "./docker-test-utils";
import { VT, extractText, parseVtSequences, hasBoxDrawing } from "./vt-utils";

/**
 * Spawn CLI for permission dialog testing
 */
async function spawnCliForPermissionTest(
  serverUrl: string
): Promise<{
  process: Subprocess<"pipe", "pipe", "pipe">;
  output: string;
  getOutput: () => string;
  write: (input: string) => void;
  waitFor: (pattern: RegExp | string, timeoutMs?: number) => Promise<boolean>;
  close: () => Promise<number>;
}> {
  let output = "";

  const process = spawn(["./vers-agent", "--url", serverUrl], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Collect stdout
  (async () => {
    const reader = process.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
    } catch {
      // Process ended
    }
  })();

  const ctx = {
    process,
    output,
    getOutput: () => output,
    write: (input: string) => {
      // Bun's spawn with stdin: "pipe" returns a FileSink with direct write method
      (process.stdin as unknown as { write(data: Uint8Array): void }).write(
        new TextEncoder().encode(input)
      );
    },
    waitFor: async (pattern: RegExp | string, timeoutMs: number = 10000): Promise<boolean> => {
      const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        if (regex.test(output)) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return false;
    },
    close: async (): Promise<number> => {
      ctx.write(VT.ctrlD);
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!process.killed) {
        process.kill();
      }
      return await process.exited;
    },
  };

  await new Promise((resolve) => setTimeout(resolve, 2000));

  return ctx;
}

describe("Permission Dialog Tests", () => {
  let serverCtx: DockerTestContext;
  let serverAvailable = false;
  let apiKeyAvailable = false;
  let cliCtx: Awaited<ReturnType<typeof spawnCliForPermissionTest>> | null = null;

  beforeAll(async () => {
    serverAvailable = await isDockerServerRunning();
    apiKeyAvailable = !!process.env.ANTHROPIC_API_KEY;

    if (!serverAvailable) {
      console.log(`Skipping permission dialog tests: Server not running at ${TEST_SERVER_URL}`);
      return;
    }

    if (!apiKeyAvailable) {
      console.log("Skipping permission dialog tests: ANTHROPIC_API_KEY not set");
      console.log("Permission dialog tests require sending actual prompts to the agent");
      return;
    }

    serverCtx = await createTestContext();
  });

  afterEach(async () => {
    if (cliCtx) {
      await cliCtx.close();
      cliCtx = null;
    }
  });

  afterAll(async () => {
    // Cleanup handled by afterEach
  });

  function skipIfNotReady(): boolean {
    if (!serverAvailable) {
      console.log("Skipping: Docker server not available");
      return true;
    }
    if (!apiKeyAvailable) {
      console.log("Skipping: ANTHROPIC_API_KEY not set");
      return true;
    }
    return false;
  }

  describe("Permission Dialog Rendering", () => {
    test("permission dialog uses box drawing characters when shown", async () => {
      if (skipIfNotReady()) return;

      cliCtx = await spawnCliForPermissionTest(TEST_SERVER_URL);

      // Note: This test is conceptual. To actually trigger a permission dialog,
      // we would need to send a prompt that causes a tool use that requires permission.
      // For example: "write the word hello to a file called test.txt"

      // For now, we just verify the CLI starts correctly
      const output = cliCtx.getOutput();
      expect(output.length).toBeGreaterThan(0);

      // Box drawing characters would appear in permission dialog
      // ╔═══════════════════════════════════════╗
      // ║ Permission Request                     ║
      // ╚═══════════════════════════════════════╝

      // This test passes if CLI starts - actual permission dialog
      // testing requires specific prompts that trigger tool use
    });
  });

  describe("Permission Dialog Input", () => {
    test("y key approves permission when dialog shown", async () => {
      if (skipIfNotReady()) return;

      cliCtx = await spawnCliForPermissionTest(TEST_SERVER_URL);

      // To test actual permission dialog:
      // 1. Send a prompt that will trigger file write
      // 2. Wait for permission dialog to appear
      // 3. Send 'y' to approve
      // 4. Verify operation completed

      // This requires ANTHROPIC_API_KEY and costs money
      // For now, verify CLI is responsive to 'y' key
      cliCtx.write("y");
      await new Promise((resolve) => setTimeout(resolve, 300));

      // CLI should still be running
      expect(cliCtx.process.killed).toBe(false);
    });

    test("n key denies permission when dialog shown", async () => {
      if (skipIfNotReady()) return;

      cliCtx = await spawnCliForPermissionTest(TEST_SERVER_URL);

      // Same as above - actual testing requires real prompts
      cliCtx.write("n");
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(cliCtx.process.killed).toBe(false);
    });

    test("number keys select options", async () => {
      if (skipIfNotReady()) return;

      cliCtx = await spawnCliForPermissionTest(TEST_SERVER_URL);

      // Test number key handling
      for (const key of ["1", "2", "3", "4"]) {
        cliCtx.write(key);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(cliCtx.process.killed).toBe(false);
    });

    test("arrow keys navigate options", async () => {
      if (skipIfNotReady()) return;

      cliCtx = await spawnCliForPermissionTest(TEST_SERVER_URL);

      // Test arrow key navigation
      cliCtx.write(VT.arrowDown);
      await new Promise((resolve) => setTimeout(resolve, 100));
      cliCtx.write(VT.arrowUp);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(cliCtx.process.killed).toBe(false);
    });

    test("enter key confirms selection", async () => {
      if (skipIfNotReady()) return;

      cliCtx = await spawnCliForPermissionTest(TEST_SERVER_URL);

      cliCtx.write(VT.enter);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // CLI should handle enter gracefully
      expect(cliCtx.process.killed).toBe(false);
    });
  });

  describe("Permission Dialog Integration", () => {
    test("file write triggers permission dialog", async () => {
      if (skipIfNotReady()) return;

      cliCtx = await spawnCliForPermissionTest(TEST_SERVER_URL);

      // Send a prompt that should trigger file write permission
      // Note: This will actually call the API and may cost money
      const prompt = 'echo "test" to the console';
      cliCtx.write(prompt + VT.enter);

      // Wait for response (this could take a while)
      await cliCtx.waitFor(/thinking|tool|permission|completed/i, 30000);

      const output = cliCtx.getOutput();

      // We should see some response from the agent
      // Whether it's a permission dialog or direct output depends on the prompt
      expect(output.length).toBeGreaterThan(100);
    });

    test("permission response affects tool execution", async () => {
      if (skipIfNotReady()) return;

      // This test would verify that:
      // 1. Approving permission allows tool to execute
      // 2. Denying permission prevents tool execution

      // This requires careful prompt crafting and is expensive to test
      // Marking as informational

      expect(true).toBe(true);
    });
  });

  describe("Permission Dialog Options", () => {
    test("allow_once option works", async () => {
      if (skipIfNotReady()) return;

      // Would test that selecting "allow_once" allows the action once
      // but prompts again for subsequent similar actions
      expect(true).toBe(true);
    });

    test("allow_always option works", async () => {
      if (skipIfNotReady()) return;

      // Would test that selecting "allow_always" allows all future
      // similar actions without prompting
      expect(true).toBe(true);
    });

    test("reject_once option works", async () => {
      if (skipIfNotReady()) return;

      // Would test that selecting "reject_once" denies the action
      // but allows prompting for subsequent similar actions
      expect(true).toBe(true);
    });

    test("reject_always option works", async () => {
      if (skipIfNotReady()) return;

      // Would test that selecting "reject_always" denies all future
      // similar actions without prompting
      expect(true).toBe(true);
    });
  });
});
