// StatusBar component tests

import React from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { StatusBar } from "../../../src/cli/components/status-bar";
import { createInkTestHarness, createMockAppState } from "../../shared";

describe("StatusBar", () => {
  const harness = createInkTestHarness();

  afterEach(async () => {
    await harness.cleanupAll();
  });

  test("returns empty when status is idle", () => {
    const { lastFrame } = harness.render(
      <StatusBar state={createMockAppState({ status: "idle" })} />
    );

    const frame = lastFrame();
    // When component returns null, lastFrame returns empty string
    expect(frame).toBe("");
  });

  test("shows thinking spinner when status is thinking", () => {
    const { lastFrame } = harness.render(
      <StatusBar state={createMockAppState({ status: "thinking" })} />
    );

    const frame = lastFrame();
    expect(frame).toContain("Thinking...");
  });

  test("shows tool name when running tool", () => {
    const { lastFrame } = harness.render(
      <StatusBar
        state={createMockAppState({ status: "running-tool", currentTool: "Read" })}
      />
    );

    const frame = lastFrame();
    expect(frame).toContain("Running Read...");
  });

  test("shows different tool names", async () => {
    const tools = ["Write", "Edit", "Bash", "Glob", "Grep"];

    for (const tool of tools) {
      const { lastFrame, cleanup } = harness.render(
        <StatusBar
          state={createMockAppState({ status: "running-tool", currentTool: tool })}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain(`Running ${tool}...`);
      await cleanup();
    }
  });

  test("handles undefined currentTool gracefully", () => {
    const { lastFrame } = harness.render(
      <StatusBar
        state={createMockAppState({ status: "running-tool", currentTool: undefined })}
      />
    );

    const frame = lastFrame();
    // Should render something even without currentTool
    expect(frame).toContain("Running");
  });
});
