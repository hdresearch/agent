// Bash escape (!command) handler

import type { HttpAcpClient } from "../../client/http-client";
import type { OutputLine } from "../types";

export interface BashHandlerContext {
  client: HttpAcpClient | null;
  isRemoteMode: boolean;
  remoteCwd: string | null;
  addOutput: (line: Omit<OutputLine, "id">) => void;
}

/**
 * Execute a bash command (! prefix)
 * @param command The command to execute (without the ! prefix)
 * @param ctx The handler context
 * @returns Promise that resolves when command completes
 */
export async function executeBashCommand(
  command: string,
  ctx: BashHandlerContext
): Promise<void> {
  const { client, isRemoteMode, remoteCwd, addOutput } = ctx;

  const cwdToShow = isRemoteMode && remoteCwd ? `(remote:${remoteCwd}) ` : "";
  addOutput({ type: "system", content: `${cwdToShow}$ ${command}` });

  try {
    let stdout: string;
    let stderr: string;
    let exitCode: number;

    if (isRemoteMode && client) {
      // Execute on remote server
      const result = await client.bashExecute(command, remoteCwd || undefined);
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } else {
      // Execute locally
      const proc = Bun.spawn(["bash", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: process.cwd(),
      });

      [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      exitCode = await proc.exited;
    }

    if (stdout.trim()) {
      addOutput({ type: "text", content: stdout.trimEnd() });
    }
    if (stderr.trim()) {
      addOutput({ type: "error", content: stderr.trimEnd() });
    }
    if (exitCode !== 0) {
      addOutput({ type: "system", content: `Exit code: ${exitCode}` });
    }
  } catch (err) {
    addOutput({ type: "error", content: `Failed to execute: ${err}` });
  }
}
