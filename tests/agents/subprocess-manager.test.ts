import { test, expect, beforeEach, afterEach } from "bun:test";
import { SubprocessManager } from "../../src/agents/subprocess-manager";

let manager: SubprocessManager;

beforeEach(() => {
  manager = new SubprocessManager();
});

afterEach(async () => {
  try {
    await manager.stopAll();
  } catch {
    // Ignore cleanup errors
  }
});

test("SubprocessManager starts with no subprocesses", () => {
  expect(manager.isRunning("test-agent")).toBe(false);
});

test("spawn starts a subprocess", async () => {
  const agentId = "test-spawn";

  // Use a simple cat command that stays open
  await manager.spawn(agentId, "cat", {}, process.cwd());
  expect(manager.isRunning(agentId)).toBe(true);
});

test("stop terminates a subprocess", async () => {
  const agentId = "test-stop";

  await manager.spawn(agentId, "cat", {}, process.cwd());
  expect(manager.isRunning(agentId)).toBe(true);

  await manager.stop(agentId);
  expect(manager.isRunning(agentId)).toBe(false);
});

test("stopAll terminates all subprocesses", async () => {
  // Spawn multiple processes
  await manager.spawn("agent1", "cat", {}, process.cwd());
  await manager.spawn("agent2", "cat", {}, process.cwd());

  expect(manager.isRunning("agent1")).toBe(true);
  expect(manager.isRunning("agent2")).toBe(true);

  await manager.stopAll();

  expect(manager.isRunning("agent1")).toBe(false);
  expect(manager.isRunning("agent2")).toBe(false);
});

test("spawn throws for already running agent", async () => {
  const agentId = "test-duplicate";

  await manager.spawn(agentId, "cat", {}, process.cwd());

  await expect(
    manager.spawn(agentId, "cat", {}, process.cwd())
  ).rejects.toThrow("already running");
});

test("request throws for non-existent agent", async () => {
  await expect(
    manager.request("nonexistent", "test/method", {})
  ).rejects.toThrow("not running");
});

test("notify throws for non-existent agent", async () => {
  await expect(
    manager.notify("nonexistent", "test/notification", {})
  ).rejects.toThrow("not running");
});

test("onRequest registers handler", () => {
  const handler = async () => ({ result: true });
  // Should not throw
  manager.onRequest(handler);
});

test("spawn with environment variables", async () => {
  const agentId = "test-env";

  // Spawn with custom env
  await manager.spawn(
    agentId,
    "cat",
    { TEST_VAR: "test-value" },
    process.cwd()
  );

  expect(manager.isRunning(agentId)).toBe(true);
});

test("spawn with different working directory", async () => {
  const agentId = "test-cwd";

  // Spawn with /tmp as cwd
  await manager.spawn(agentId, "cat", {}, "/tmp");

  expect(manager.isRunning(agentId)).toBe(true);
});

test("getState returns null for non-existent agent", () => {
  const state = manager.getState("nonexistent");
  expect(state).toBeUndefined();
});

test("getState returns state for running agent", async () => {
  const agentId = "test-state";

  await manager.spawn(agentId, "cat", {}, process.cwd());

  const state = manager.getState(agentId);
  expect(state).toBeDefined();
  expect(state?.agentId).toBe(agentId);
});
