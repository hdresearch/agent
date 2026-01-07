// CLI entry point
// This is the main entry point for the vers-agent CLI

import React from "react";
import { render } from "ink";
import { App } from "./app";

export type { CliOptions } from "./types";

/**
 * Run the interactive CLI
 */
export async function runCli(options: { continueSession?: boolean; serverUrl?: string } = {}) {
  // Ignore SIGINT - let useInput handle Ctrl+C instead
  // This is critical for compiled binaries where SIGINT handling differs
  const originalSigintListeners = process.listeners("SIGINT");
  process.removeAllListeners("SIGINT");
  process.on("SIGINT", () => {
    // Do nothing - Ctrl+C is handled by useInput via exitOnCtrlC: false
  });

  const { waitUntilExit } = render(
    <App
      initialContinue={options.continueSession ?? false}
      serverUrl={options.serverUrl}
    />,
    {
      // Let useInput handle Ctrl+C instead of exiting
      exitOnCtrlC: false,
    }
  );

  try {
    await waitUntilExit();
  } finally {
    // Restore original SIGINT listeners
    process.removeAllListeners("SIGINT");
    for (const listener of originalSigintListeners) {
      process.on("SIGINT", listener as NodeJS.SignalsListener);
    }
  }
}
