import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { AcpServer } from "../../src/agents/acp-server";
import type { JsonRpcRequest } from "../../src/protocol/jsonrpc";

describe("AcpServer terminal execution", () => {
  let server: AcpServer;
  const testCwd = process.cwd();

  beforeEach(() => {
    server = new AcpServer(testCwd);
  });

  afterEach(() => {
    server.cleanup();
  });

  function makeRequest(method: string, params: unknown): JsonRpcRequest {
    return {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    };
  }

  describe("terminal/create with shell wrapping", () => {
    test("executes simple command and returns output", async () => {
      const createResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", {
          command: "echo",
          args: ["hello world"],
        })
      ) as { terminalId: string };

      expect(createResult.terminalId).toBe("terminal-1");

      // Wait for the process to exit
      const exitResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", {
          terminalId: createResult.terminalId,
        })
      ) as { exitCode: number };

      expect(exitResult.exitCode).toBe(0);

      // Get the output
      const outputResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", {
          terminalId: createResult.terminalId,
        })
      ) as { output: string; truncated: boolean; exitStatus?: { exitCode: number } };

      expect(outputResult.output.trim()).toBe("hello world");
      expect(outputResult.truncated).toBe(false);
      expect(outputResult.exitStatus?.exitCode).toBe(0);
    });

    test("executes shell command with pipes", async () => {
      const createResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", {
          command: "echo 'line1\nline2\nline3' | wc -l",
        })
      ) as { terminalId: string };

      const exitResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", {
          terminalId: createResult.terminalId,
        })
      ) as { exitCode: number };

      expect(exitResult.exitCode).toBe(0);

      const outputResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", {
          terminalId: createResult.terminalId,
        })
      ) as { output: string };

      expect(outputResult.output.trim()).toBe("3");
    });

    test("executes command with environment variables", async () => {
      const createResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", {
          command: "echo $TEST_VAR",
          env: [{ name: "TEST_VAR", value: "test_value_123" }],
        })
      ) as { terminalId: string };

      await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", {
          terminalId: createResult.terminalId,
        })
      );

      const outputResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", {
          terminalId: createResult.terminalId,
        })
      ) as { output: string };

      expect(outputResult.output.trim()).toBe("test_value_123");
    });
  });

  describe("conversation continues after terminal execution", () => {
    test("can execute multiple commands sequentially", async () => {
      // First command
      const create1 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", { command: "echo first" })
      ) as { terminalId: string };

      await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", { terminalId: create1.terminalId })
      );

      const output1 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", { terminalId: create1.terminalId })
      ) as { output: string };

      expect(output1.output.trim()).toBe("first");

      // Second command - simulates conversation continuing
      const create2 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", { command: "echo second" })
      ) as { terminalId: string };

      await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", { terminalId: create2.terminalId })
      );

      const output2 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", { terminalId: create2.terminalId })
      ) as { output: string };

      expect(output2.output.trim()).toBe("second");

      // Verify both terminals exist with different IDs
      expect(create1.terminalId).toBe("terminal-1");
      expect(create2.terminalId).toBe("terminal-2");
    });

    test("wait_for_exit does not hang on commands with large output", async () => {
      // This command generates a lot of output that could fill the pipe buffer
      // The fix ensures we drain the stream even after hitting the limit
      const createResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", {
          command: "for i in $(seq 1 10000); do echo \"line $i: some padding text to make it longer\"; done",
          outputByteLimit: 1024, // Small limit to trigger truncation
        })
      ) as { terminalId: string };

      // This should complete without hanging
      const exitResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", {
          terminalId: createResult.terminalId,
        })
      ) as { exitCode: number };

      expect(exitResult.exitCode).toBe(0);

      const outputResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", {
          terminalId: createResult.terminalId,
        })
      ) as { output: string; truncated: boolean };

      expect(outputResult.truncated).toBe(true);
      // Output should be limited
      expect(outputResult.output.length).toBeLessThanOrEqual(1024);
    });

    test("can continue after a failing command", async () => {
      // Command that fails
      const create1 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", { command: "exit 42" })
      ) as { terminalId: string };

      const exit1 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", { terminalId: create1.terminalId })
      ) as { exitCode: number };

      expect(exit1.exitCode).toBe(42);

      // Should be able to run another command after failure
      const create2 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", { command: "echo recovered" })
      ) as { terminalId: string };

      const exit2 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", { terminalId: create2.terminalId })
      ) as { exitCode: number };

      expect(exit2.exitCode).toBe(0);

      const output2 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", { terminalId: create2.terminalId })
      ) as { output: string };

      expect(output2.output.trim()).toBe("recovered");
    });
  });

  describe("incremental output", () => {
    test("terminal/output returns only new data on subsequent calls", async () => {
      const createResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", {
          command: "echo -n 'abc'; sleep 0.1; echo -n 'def'",
        })
      ) as { terminalId: string };

      await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", { terminalId: createResult.terminalId })
      );

      // First read gets all output
      const output1 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", { terminalId: createResult.terminalId })
      ) as { output: string };

      expect(output1.output).toBe("abcdef");

      // Second read should return empty (no new data)
      const output2 = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", { terminalId: createResult.terminalId })
      ) as { output: string };

      expect(output2.output).toBe("");
    });
  });

  describe("terminal cleanup", () => {
    test("terminal/release cleans up terminal", async () => {
      const createResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/create", { command: "echo test" })
      ) as { terminalId: string };

      await server.handleRequest(
        "test-agent",
        makeRequest("terminal/wait_for_exit", { terminalId: createResult.terminalId })
      );

      // Release the terminal
      await server.handleRequest(
        "test-agent",
        makeRequest("terminal/release", { terminalId: createResult.terminalId })
      );

      // Subsequent output call should return error state
      const outputResult = await server.handleRequest(
        "test-agent",
        makeRequest("terminal/output", { terminalId: createResult.terminalId })
      ) as { output: string; exitStatus?: { exitCode: number } };

      expect(outputResult.output).toBe("");
      expect(outputResult.exitStatus?.exitCode).toBe(-1);
    });
  });
});
