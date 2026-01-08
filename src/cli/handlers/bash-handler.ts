// Bash escape (!command) handler - always executes on server

import type { HttpAcpClient } from "../../client/http-client";
import type { OutputLine } from "../types";

export interface BashHandlerContext {
  client: HttpAcpClient | null;
  remoteCwd: string | null;
  addOutput: (line: Omit<OutputLine, "id">) => void;
}

/**
 * Execute a bash command on the server (! prefix)
 * @param command The command to execute (without the ! prefix)
 * @param ctx The handler context
 * @returns Promise that resolves when command completes
 */
export async function executeBashCommand(
  command: string,
  ctx: BashHandlerContext
): Promise<void> {
  const { client, remoteCwd, addOutput } = ctx;

  if (!client) {
    addOutput({ type: "error", content: "Not connected to server" });
    return;
  }

  const cwdDisplay = remoteCwd ? `${remoteCwd}` : "~";
  addOutput({ type: "system", content: `${cwdDisplay} $ ${command}` });

  try {
    const result = await client.bashExecute(command, remoteCwd || undefined);

    if (result.stdout.trim()) {
      addOutput({ type: "text", content: result.stdout.trimEnd() });
    }
    if (result.stderr.trim()) {
      addOutput({ type: "error", content: result.stderr.trimEnd() });
    }
    if (result.exitCode !== 0) {
      addOutput({ type: "system", content: `Exit code: ${result.exitCode}` });
    }
  } catch (err) {
    addOutput({ type: "error", content: `Failed to execute: ${err}` });
  }
}
