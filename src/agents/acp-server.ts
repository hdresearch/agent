// ACP Server - handles JSON-RPC callbacks from agent subprocesses
// Implements the server side of the ACP protocol (agent → client)

import { join, resolve, isAbsolute } from "node:path";
import type { JsonRpcRequest } from "../protocol/jsonrpc";
import type {
  AcpSessionUpdate,
  AcpFsReadTextFileParams,
  AcpFsReadTextFileResult,
  AcpFsWriteTextFileParams,
  AcpTerminalCreateParams,
  AcpTerminalCreateResult,
  AcpTerminalOutputParams,
  AcpTerminalOutputResult,
  AcpTerminalKillParams,
  AcpTerminalWaitForExitParams,
  AcpTerminalWaitForExitResult,
  AcpTerminalReleaseParams,
  AcpRequestPermissionParams,
  AcpRequestPermissionResult,
} from "./types";

// ============================================================
// Types
// ============================================================

export type SessionUpdateHandler = (
  agentId: string,
  sessionId: string,
  update: AcpSessionUpdate
) => void;

export type PermissionHandler = (
  agentId: string,
  params: AcpRequestPermissionParams
) => Promise<AcpRequestPermissionResult>;

// Properly typed subprocess with pipe I/O for terminals
interface PipedTerminalProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  pid: number;
  killed: boolean;
  exitCode: number | null;
  kill(signal?: number | NodeJS.Signals): void;
  exited: Promise<number>;
}

interface TerminalState {
  process: PipedTerminalProcess;
  output: string;
  truncated: boolean;
  exitCode: number | null;
  signal: string | null;
  exitPromise: Promise<{ exitCode: number; signal: string | null }>;
  exitResolve: (result: { exitCode: number; signal: string | null }) => void;
}

// ============================================================
// ACP Server
// ============================================================

export class AcpServer {
  private cwd: string;
  private sessionUpdateHandler: SessionUpdateHandler | null = null;
  private permissionHandler: PermissionHandler | null = null;
  private terminals: Map<string, TerminalState> = new Map();
  private terminalCounter = 0;
  private maxOutputBytes = 1024 * 1024; // 1MB default

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Set the handler for session updates
   */
  onSessionUpdate(handler: SessionUpdateHandler): void {
    this.sessionUpdateHandler = handler;
  }

  /**
   * Set the handler for permission requests
   */
  onPermissionRequest(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }

  /**
   * Handle an incoming JSON-RPC request from an agent
   */
  async handleRequest(
    agentId: string,
    request: JsonRpcRequest
  ): Promise<unknown> {
    const { method, params } = request;

    switch (method) {
      case "session/update":
        return this.handleSessionUpdate(agentId, params as {
          sessionId: string;
          update: AcpSessionUpdate;
        });

      case "session/request_permission":
        return this.handleRequestPermission(
          agentId,
          params as AcpRequestPermissionParams
        );

      case "fs/read_text_file":
        return this.handleFsReadTextFile(params as AcpFsReadTextFileParams);

      case "fs/write_text_file":
        return this.handleFsWriteTextFile(params as AcpFsWriteTextFileParams);

      case "terminal/create":
        return this.handleTerminalCreate(params as AcpTerminalCreateParams);

      case "terminal/output":
        return this.handleTerminalOutput(params as AcpTerminalOutputParams);

      case "terminal/kill":
        return this.handleTerminalKill(params as AcpTerminalKillParams);

      case "terminal/wait_for_exit":
        return this.handleTerminalWaitForExit(
          params as AcpTerminalWaitForExitParams
        );

      case "terminal/release":
        return this.handleTerminalRelease(params as AcpTerminalReleaseParams);

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  // ============================================================
  // Session Update Handler
  // ============================================================

  private handleSessionUpdate(
    agentId: string,
    params: { sessionId: string; update: AcpSessionUpdate }
  ): void {
    if (this.sessionUpdateHandler) {
      this.sessionUpdateHandler(agentId, params.sessionId, params.update);
    }
    // session/update is a notification, no return value needed
  }

  // ============================================================
  // Permission Request Handler
  // ============================================================

  private async handleRequestPermission(
    agentId: string,
    params: AcpRequestPermissionParams
  ): Promise<AcpRequestPermissionResult> {
    if (this.permissionHandler) {
      return this.permissionHandler(agentId, params);
    }

    // Default: auto-approve with "allow_once"
    const allowOption = params.options.find(
      opt => opt.kind === "allow_once" || opt.kind === "allow_always"
    );

    if (allowOption) {
      return {
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      };
    }

    // Fallback: use first option
    return {
      outcome: {
        outcome: "selected",
        optionId: params.options[0]?.optionId ?? "allow",
      },
    };
  }

  // ============================================================
  // File System Handlers
  // ============================================================

  private async handleFsReadTextFile(
    params: AcpFsReadTextFileParams
  ): Promise<AcpFsReadTextFileResult> {
    // Resolve path relative to cwd
    const filePath = this.resolvePath(params.path);

    try {
      const file = Bun.file(filePath);
      let content = await file.text();

      // Handle line/limit parameters
      if (params.line !== undefined) {
        const lines = content.split("\n");
        const startLine = Math.max(0, params.line - 1); // 1-indexed to 0-indexed
        const endLine = params.limit
          ? startLine + params.limit
          : lines.length;
        content = lines.slice(startLine, endLine).join("\n");
      }

      return { content };
    } catch (error) {
      // Return empty content on read error (like Toad does)
      return { content: "" };
    }
  }

  private async handleFsWriteTextFile(
    params: AcpFsWriteTextFileParams
  ): Promise<void> {
    const filePath = this.resolvePath(params.path);
    await Bun.write(filePath, params.content);
  }

  // ============================================================
  // Terminal Handlers
  // ============================================================

  private async handleTerminalCreate(
    params: AcpTerminalCreateParams
  ): Promise<AcpTerminalCreateResult> {
    this.terminalCounter++;
    const terminalId = `terminal-${this.terminalCounter}`;

    // Build command
    const args = params.args ?? [];
    const cwd = params.cwd ? this.resolvePath(params.cwd) : this.cwd;

    // Build environment, filtering out undefined values
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (params.env) {
      for (const { name, value } of params.env) {
        env[name] = value;
      }
    }

    // Spawn the process with pipe I/O
    const bunProc = Bun.spawn([params.command, ...args], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Cast to PipedTerminalProcess since we know we're using pipe mode
    const proc = bunProc as unknown as PipedTerminalProcess;

    // Create exit promise
    let exitResolve: (result: { exitCode: number; signal: string | null }) => void;
    const exitPromise = new Promise<{ exitCode: number; signal: string | null }>(
      resolve => {
        exitResolve = resolve;
      }
    );

    const state: TerminalState = {
      process: proc,
      output: "",
      truncated: false,
      exitCode: null,
      signal: null,
      exitPromise,
      exitResolve: exitResolve!,
    };

    this.terminals.set(terminalId, state);

    // Start output collection
    this.collectTerminalOutput(terminalId, state, params.outputByteLimit);

    return { terminalId };
  }

  private async collectTerminalOutput(
    terminalId: string,
    state: TerminalState,
    outputByteLimit?: number
  ): Promise<void> {
    const maxBytes = outputByteLimit ?? this.maxOutputBytes;
    const decoder = new TextDecoder();

    // Collect stdout
    const stdoutReader = state.process.stdout.getReader();
    const stderrReader = state.process.stderr.getReader();

    // Use a generic type to handle both Bun and Node.js stream reader types
    type StreamReader = {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      releaseLock(): void;
    };

    const collectStream = async (reader: StreamReader) => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          const text = decoder.decode(value, { stream: true });
          if (state.output.length + text.length > maxBytes) {
            state.output += text.slice(0, maxBytes - state.output.length);
            state.truncated = true;
            break;
          }
          state.output += text;
        }
      } catch {
        // Stream ended
      } finally {
        reader.releaseLock();
      }
    };

    // Collect both streams
    await Promise.all([
      collectStream(stdoutReader as unknown as StreamReader),
      collectStream(stderrReader as unknown as StreamReader),
    ]);

    // Wait for process exit
    const exitCode = await state.process.exited;
    state.exitCode = exitCode;

    // Resolve exit promise
    state.exitResolve({
      exitCode,
      signal: state.signal,
    });
  }

  private handleTerminalOutput(
    params: AcpTerminalOutputParams
  ): AcpTerminalOutputResult {
    const state = this.terminals.get(params.terminalId);
    if (!state) {
      return {
        output: "",
        truncated: false,
        exitStatus: { exitCode: -1 },
      };
    }

    const result: AcpTerminalOutputResult = {
      output: state.output,
      truncated: state.truncated,
    };

    if (state.exitCode !== null) {
      result.exitStatus = {
        exitCode: state.exitCode,
        signal: state.signal ?? undefined,
      };
    }

    return result;
  }

  private handleTerminalKill(params: AcpTerminalKillParams): void {
    const state = this.terminals.get(params.terminalId);
    if (state && !state.process.killed) {
      state.signal = "SIGTERM";
      state.process.kill();
    }
  }

  private async handleTerminalWaitForExit(
    params: AcpTerminalWaitForExitParams
  ): Promise<AcpTerminalWaitForExitResult> {
    const state = this.terminals.get(params.terminalId);
    if (!state) {
      return { exitCode: -1 };
    }

    const result = await state.exitPromise;
    return {
      exitCode: result.exitCode,
      signal: result.signal ?? undefined,
    };
  }

  private handleTerminalRelease(params: AcpTerminalReleaseParams): void {
    const state = this.terminals.get(params.terminalId);
    if (state) {
      if (!state.process.killed) {
        state.process.kill();
      }
      this.terminals.delete(params.terminalId);
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private resolvePath(path: string): string {
    if (isAbsolute(path)) {
      return path;
    }
    return resolve(this.cwd, path);
  }

  /**
   * Clean up all terminals
   */
  cleanup(): void {
    for (const [id, state] of this.terminals) {
      if (!state.process.killed) {
        state.process.kill();
      }
    }
    this.terminals.clear();
  }
}
