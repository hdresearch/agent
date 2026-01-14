// ACP Client - makes JSON-RPC calls to agent subprocesses
// Implements the client side of the ACP protocol

import type { SubprocessManager } from "./subprocess-manager";
import type {
  AcpClientCapabilities,
  AcpImplementation,
  AcpInitializeResult,
  AcpAgentCapabilities,
  AcpSessionNewParams,
  AcpSessionNewResult,
  AcpContentBlock,
  AcpSessionPromptResult,
  AcpMcpServer,
} from "./types";
import {
  type AcpAgentConfig,
  DEFAULT_ACP_CONFIG,
} from "../protocol/acp-types";

// ============================================================
// Protocol Constants
// ============================================================

const PROTOCOL_VERSION = 1;

// ============================================================
// ACP Client
// ============================================================

export class AcpClient {
  private subprocess: SubprocessManager;
  private agentId: string;
  private config: AcpAgentConfig;
  private sessionId: string | null = null;
  private claudeSessionId: string | null = null; // Claude CLI's actual session ID (8-char format)
  private capabilities: AcpAgentCapabilities = {};

  constructor(
    subprocess: SubprocessManager,
    agentId: string,
    config?: AcpAgentConfig
  ) {
    this.subprocess = subprocess;
    this.agentId = agentId;
    this.config = config ?? DEFAULT_ACP_CONFIG;
  }

  /**
   * Get the current config
   */
  getConfig(): AcpAgentConfig {
    return this.config;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Update the session ID (e.g., from session/update notifications)
   * This is needed because some agents send the real session ID in notifications
   * rather than in the session/new response.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Get Claude CLI's actual session ID (8-char format)
   * This is the ID that Claude Code uses internally and needs for resume
   */
  getClaudeSessionId(): string | null {
    return this.claudeSessionId;
  }

  /**
   * Set Claude CLI's actual session ID (from session/update notifications)
   * This should be called when we receive the first sessionId from notifications
   */
  setClaudeSessionId(sessionId: string): void {
    this.claudeSessionId = sessionId;
  }

  /**
   * Clear Claude CLI's session ID (for /clear command)
   */
  clearClaudeSessionId(): void {
    this.claudeSessionId = null;
  }

  /**
   * Get agent capabilities (after initialize)
   */
  getCapabilities(): AcpAgentCapabilities {
    return this.capabilities;
  }

  /**
   * Initialize the ACP connection
   * https://agentclientprotocol.com/protocol/initialization
   */
  async initialize(
    capabilitiesOverride?: AcpClientCapabilities
  ): Promise<AcpInitializeResult> {
    // Use override if provided, otherwise use config capabilities
    // Convert ClientCapabilities to AcpClientCapabilities format
    const capabilities = capabilitiesOverride ?? {
      fs: {
        readTextFile: this.config.capabilities.fileSystem?.read ?? true,
        writeTextFile: this.config.capabilities.fileSystem?.write ?? true,
      },
      terminal: this.config.capabilities.terminal?.create ?? true,
    };

    const result = await this.subprocess.request<AcpInitializeResult>(
      this.agentId,
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: capabilities,
        clientInfo: {
          name: this.config.clientInfo.name,
          version: this.config.clientInfo.version,
          title: `${this.config.clientInfo.name} ACP Host`,
        },
      }
    );

    // Store agent capabilities
    if (result.agentCapabilities) {
      this.capabilities = result.agentCapabilities;
    }

    return result;
  }

  /**
   * Create a new session
   * https://agentclientprotocol.com/protocol/session-setup
   * @param cwd - Working directory for the session
   * @param mcpServers - Optional MCP servers to connect
   * @param resumeSessionId - Optional session ID to resume (for Claude Code)
   */
  async sessionNew(
    cwd: string,
    mcpServers?: AcpMcpServer[],
    resumeSessionId?: string
  ): Promise<AcpSessionNewResult> {
    const params: AcpSessionNewParams & { _meta?: unknown } = {
      cwd,
      mcpServers: mcpServers ?? [],
    };

    // Pass resume session ID to Claude Code via _meta
    // - `resume`: Tells claude-code-acp to use this session ID (and not set --session-id)
    // - `extraArgs.resume`: Passes --resume <sessionId> to Claude CLI for actual resume
    // Both are needed: `resume` sets the ACP session ID, `extraArgs.resume` tells Claude CLI to resume
    if (resumeSessionId) {
      params._meta = {
        claudeCode: {
          options: {
            resume: resumeSessionId,
            extraArgs: {
              resume: resumeSessionId,
            },
          },
        },
      };
    }

    const result = await this.subprocess.request<AcpSessionNewResult>(
      this.agentId,
      "session/new",
      params
    );

    // Store session ID - but don't overwrite if already set from notification
    // (notification may arrive before response and have the authoritative session ID)
    if (!this.sessionId && result.sessionId) {
      this.sessionId = result.sessionId;
    }

    return result;
  }

  /**
   * Send a prompt to the agent
   * https://agentclientprotocol.com/protocol/prompt-turn
   */
  async sessionPrompt(prompt: AcpContentBlock[]): Promise<AcpSessionPromptResult> {
    if (!this.sessionId) {
      throw new Error("No active session - call sessionNew first");
    }

    // Activity timeout - if no messages from agent for 60s, consider it dead
    // (timeout resets on any message from agent, so long-running tasks are fine)
    const ACTIVITY_TIMEOUT = 60 * 1000;
    const result = await this.subprocess.request<AcpSessionPromptResult>(
      this.agentId,
      "session/prompt",
      {
        sessionId: this.sessionId,
        prompt,
      },
      ACTIVITY_TIMEOUT
    );

    return result;
  }

  /**
   * Send a text prompt (convenience method)
   */
  async prompt(text: string): Promise<AcpSessionPromptResult> {
    return this.sessionPrompt([{ type: "text", text }]);
  }

  /**
   * Cancel the current operation
   * https://agentclientprotocol.com/protocol/prompt-turn#cancellation
   */
  async sessionCancel(): Promise<void> {
    if (!this.sessionId) {
      return; // Nothing to cancel
    }

    // Cancel is a notification, not a request
    await this.subprocess.notify(this.agentId, "session/cancel", {
      sessionId: this.sessionId,
      _meta: {},
    });
  }

  /**
   * Set the session mode
   * https://agentclientprotocol.com/protocol/session-modes
   */
  async sessionSetMode(modeId: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error("No active session");
    }

    await this.subprocess.request(this.agentId, "session/set_mode", {
      sessionId: this.sessionId,
      modeId,
    });
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create content blocks from text and optional images
 */
export function createContentBlocks(
  text: string,
  images?: Array<{ base64: string; mimeType: string }>
): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = [];

  // Add text block
  if (text) {
    blocks.push({ type: "text", text });
  }

  // Add image blocks
  if (images) {
    for (const img of images) {
      blocks.push({
        type: "image",
        data: img.base64,
        mimeType: img.mimeType,
      });
    }
  }

  return blocks;
}
