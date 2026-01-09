// Ink component test utilities
// Provides proper cleanup handling for ink-testing-library

import type { ReactElement } from "react";
import { render, cleanup as inkGlobalCleanup } from "ink-testing-library";
import { flushAsync, waitUntil, type WaitUntilOptions } from "./sync";

export type { Instance } from "ink-testing-library";

/**
 * Result of rendering an Ink component with enhanced cleanup
 */
export interface InkRenderResult {
  /** Get the last rendered frame */
  lastFrame: () => string | undefined;
  /** Get all frames rendered so far */
  frames: string[];
  /** Write to stdin */
  stdin: { write: (data: string) => void };
  /** Unmount the component */
  unmount: () => void;
  /** Cleanup with proper async handling */
  cleanup: () => Promise<void>;
  /** Rerender with new props */
  rerender: (element: ReactElement) => void;
}

/**
 * Render an Ink component with enhanced cleanup handling
 *
 * The cleanup method properly handles Ink's stdin listener detachment
 * which can leak between tests if not properly awaited
 */
export function renderInk(element: ReactElement): InkRenderResult {
  const instance = render(element);

  return {
    lastFrame: instance.lastFrame,
    frames: instance.frames,
    stdin: instance.stdin,
    unmount: instance.unmount,
    rerender: instance.rerender,
    cleanup: async () => {
      instance.unmount();
      inkGlobalCleanup();
      // Flush async queues to allow Ink's stdin listeners to fully detach
      // This replaces the arbitrary 20ms setTimeout hack
      await flushAsync(5);
    },
  };
}

/**
 * Test harness for Ink components
 * Automatically tracks rendered instances for cleanup
 *
 * Usage:
 * ```typescript
 * const harness = createInkTestHarness();
 *
 * afterEach(async () => {
 *   await harness.cleanupAll();
 * });
 *
 * test('example', () => {
 *   const { lastFrame } = harness.render(<MyComponent />);
 *   expect(lastFrame()).toContain('expected');
 * });
 * ```
 */
export function createInkTestHarness() {
  const instances: InkRenderResult[] = [];

  return {
    /**
     * Render a component and track it for cleanup
     */
    render(element: ReactElement): InkRenderResult {
      const result = renderInk(element);
      instances.push(result);
      return result;
    },

    /**
     * Cleanup all rendered instances
     * Should be called in afterEach
     */
    async cleanupAll(): Promise<void> {
      // Cleanup in reverse order (LIFO)
      for (let i = instances.length - 1; i >= 0; i--) {
        await instances[i].cleanup();
      }
      instances.length = 0;
    },

    /**
     * Get the number of tracked instances
     */
    get instanceCount(): number {
      return instances.length;
    },
  };
}

/**
 * Wait for an Ink frame to contain expected content
 *
 * Usage:
 * ```typescript
 * const { lastFrame } = harness.render(<MyComponent />);
 * await waitForFrame(lastFrame, /Loading/);
 * ```
 */
export async function waitForFrame(
  getFrame: () => string | undefined,
  pattern: string | RegExp,
  options?: WaitUntilOptions
): Promise<string> {
  let frame: string | undefined;

  await waitUntil(
    () => {
      frame = getFrame();
      if (!frame) return false;

      if (typeof pattern === "string") {
        return frame.includes(pattern);
      }
      return pattern.test(frame);
    },
    {
      interval: 10,
      message: `Frame did not match ${pattern} within timeout`,
      ...options,
    }
  );

  return frame!;
}

/**
 * Wait for Ink frame to stabilize (stop changing)
 * Useful for animations that eventually settle
 */
export async function waitForStableFrame(
  getFrame: () => string | undefined,
  options?: { stabilityMs?: number } & WaitUntilOptions
): Promise<string> {
  const { stabilityMs = 100, ...waitOptions } = options ?? {};
  let lastFrame = "";
  let stableTime = 0;
  let lastCheck = Date.now();

  await waitUntil(
    () => {
      const frame = getFrame() ?? "";
      const now = Date.now();

      if (frame === lastFrame) {
        stableTime += now - lastCheck;
      } else {
        lastFrame = frame;
        stableTime = 0;
      }

      lastCheck = now;
      return stableTime >= stabilityMs;
    },
    {
      interval: 20,
      message: `Frame did not stabilize within timeout`,
      ...waitOptions,
    }
  );

  return lastFrame;
}

// Re-export the global cleanup for direct use if needed
export { cleanup as inkGlobalCleanup } from "ink-testing-library";
