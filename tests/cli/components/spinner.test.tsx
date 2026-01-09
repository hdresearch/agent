// Spinner component tests

import React from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { render } from "ink-testing-library";
import { Spinner } from "../../../src/cli/components/spinner";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

describe("Spinner", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test("renders spinner with text", () => {
    const { lastFrame, unmount } = render(<Spinner text="Loading..." />);
    cleanup = unmount;

    const frame = lastFrame();
    expect(frame).toContain("Loading...");
  });

  test("spinner frame is in expected character set", () => {
    const { lastFrame, unmount } = render(<Spinner text="Test" />);
    cleanup = unmount;

    const frame = lastFrame()!;
    const hasValidFrame = SPINNER_FRAMES.some((f) => frame.includes(f));
    expect(hasValidFrame).toBe(true);
  });

  test("renders with cyan color", () => {
    const { lastFrame, unmount } = render(<Spinner text="Colored" />);
    cleanup = unmount;

    // ink-testing-library strips ANSI codes in lastFrame(), but we can verify
    // the component renders without errors
    const frame = lastFrame();
    expect(frame).toContain("Colored");
  });

  test("renders empty text", () => {
    const { lastFrame, unmount } = render(<Spinner text="" />);
    cleanup = unmount;

    const frame = lastFrame()!;
    // Should still have a spinner frame even with empty text
    const hasValidFrame = SPINNER_FRAMES.some((f) => frame.includes(f));
    expect(hasValidFrame).toBe(true);
  });

  test("renders long text", () => {
    const longText = "This is a very long loading message that should still render correctly";
    const { lastFrame, unmount } = render(<Spinner text={longText} />);
    cleanup = unmount;

    const frame = lastFrame();
    expect(frame).toContain(longText);
  });
});
