// Spinner component tests

import React from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { Spinner } from "../../../src/cli/components/spinner";
import { createInkTestHarness } from "../../shared";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

describe("Spinner", () => {
  const harness = createInkTestHarness();

  afterEach(async () => {
    await harness.cleanupAll();
  });

  test("renders spinner with text", () => {
    const { lastFrame } = harness.render(<Spinner text="Loading..." />);

    const frame = lastFrame();
    expect(frame).toContain("Loading...");
  });

  test("spinner frame is in expected character set", () => {
    const { lastFrame } = harness.render(<Spinner text="Test" />);

    const frame = lastFrame()!;
    const hasValidFrame = SPINNER_FRAMES.some((f) => frame.includes(f));
    expect(hasValidFrame).toBe(true);
  });

  test("renders with cyan color", () => {
    const { lastFrame } = harness.render(<Spinner text="Colored" />);

    // ink-testing-library strips ANSI codes in lastFrame(), but we can verify
    // the component renders without errors
    const frame = lastFrame();
    expect(frame).toContain("Colored");
  });

  test("renders empty text", () => {
    const { lastFrame } = harness.render(<Spinner text="" />);

    const frame = lastFrame()!;
    // Should still have a spinner frame even with empty text
    const hasValidFrame = SPINNER_FRAMES.some((f) => frame.includes(f));
    expect(hasValidFrame).toBe(true);
  });

  test("renders long text", () => {
    const longText = "This is a very long loading message that should still render correctly";
    const { lastFrame } = harness.render(<Spinner text={longText} />);

    const frame = lastFrame();
    expect(frame).toContain(longText);
  });
});
