// StatusBar component tests

import React from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { render } from "ink-testing-library";
import { StatusBar } from "../../../src/cli/components/status-bar";
import { createMockAppState } from "./test-utils";

describe("StatusBar", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test("returns empty when status is idle", () => {
    const { lastFrame, unmount } = render(
      <StatusBar state={createMockAppState({ status: "idle" })} />
    );
    cleanup = unmount;

    const frame = lastFrame();
    // When component returns null, lastFrame returns empty string
    expect(frame).toBe("");
  });

  test("shows thinking spinner when status is thinking", () => {
    const { lastFrame, unmount } = render(
      <StatusBar state={createMockAppState({ status: "thinking" })} />
    );
    cleanup = unmount;

    const frame = lastFrame();
    expect(frame).toContain("Thinking...");
  });

  test("shows tool name when running tool", () => {
    const { lastFrame, unmount } = render(
      <StatusBar
        state={createMockAppState({ status: "running-tool", currentTool: "Read" })}
      />
    );
    cleanup = unmount;

    const frame = lastFrame();
    expect(frame).toContain("Running Read...");
  });

  test("shows different tool names", () => {
    const tools = ["Write", "Edit", "Bash", "Glob", "Grep"];

    for (const tool of tools) {
      const { lastFrame, unmount } = render(
        <StatusBar
          state={createMockAppState({ status: "running-tool", currentTool: tool })}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain(`Running ${tool}...`);
      unmount();
    }
  });

  test("handles undefined currentTool gracefully", () => {
    const { lastFrame, unmount } = render(
      <StatusBar
        state={createMockAppState({ status: "running-tool", currentTool: undefined })}
      />
    );
    cleanup = unmount;

    const frame = lastFrame();
    // Should render something even without currentTool
    expect(frame).toContain("Running");
  });
});
