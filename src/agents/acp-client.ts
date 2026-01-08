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

// ============================================================
// Protocol Constants
// ============================================================

const PROTOCOL_VERSION = 1;

const CLIENT_INFO: AcpImplementation = {
  name: "vers-agent",
  version: "1.0.0",
  title: "vers-agent ACP Host",
};

const DEFAULT_CLIENT_CAPABILITIES: AcpClientCapabilities = {
  fs: {
    readTextFile: true,
    writeTextFile: true,
  },
  terminal: true,
};

// ============================================================
// ACP Client
// ============================================================

export class AcpClient {
  private subprocess: SubprocessManager;
  private agentId: string;
  private sessionId: string | null = null;
  private capabilities: AcpAgentCapabilities = {};

  constructor(subprocess: SubprocessManager, agentId: string) {
    this.subprocess = subprocess;
    this.agentId = agentId;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
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
    capabilities?: AcpClientCapabilities
  ): Promise<AcpInitializeResult> {
    const result = await this.subprocess.request<AcpInitializeResult>(
      this.agentId,
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: capabilities ?? DEFAULT_CLIENT_CAPABILITIES,
        clientInfo: CLIENT_INFO,
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
   */
  async sessionNew(
    cwd: string,
    mcpServers?: AcpMcpServer[]
  ): Promise<AcpSessionNewResult> {
    const params: AcpSessionNewParams = {
      cwd,
      mcpServers: mcpServers ?? [],
    };

    const result = await this.subprocess.request<AcpSessionNewResult>(
      this.agentId,
      "session/new",
      params
    );

    // Store session ID
    this.sessionId = result.sessionId;

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
