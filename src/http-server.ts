// HTTP + SSE server for ACP
// POST /rpc - JSON-RPC requests
// GET /events - SSE stream for notifications

import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  createResponse,
  createErrorResponse,
  ErrorCode,
  parseMessage,
} from "./jsonrpc";
import {
  AcpMethod,
  type InitializeParams,
  type InitializeResult,
  type AuthenticateParams,
  type AuthenticateResult,
  type NewSessionParams,
  type NewSessionResult,
  type LoadSessionParams,
  type LoadSessionResult,
  type PromptParams,
  type PromptResult,
  type SetModeParams,
  type SetModeResult,
  type CancelParams,
  type CancelResult,
  type SessionNotificationParams,
  type AgentCapabilities,
} from "./acp-types";
import { runTask, cancelTask, clearProjectDocsCache, markDocsForReinjection } from "./agent";
import { getDocs, setDocs, setDoc, getDocsStore, loadDocsStore, type StoredDoc } from "./docs-store";
import { taskStore } from "./tasks";
import { getConfig, setConfig, getSession, resetSession, updateSession, loadConfig, getMcpServers, addMcpServer, removeMcpServer, type McpServerConfig, setSessionMode, getSessionMode, getPlan, setPlan, clearPlan, type PlanEntry } from "./config";
import { loadStoredKeys, saveKeys, computeKeysHash, type KeysState } from "./keys";
import { expandPrompt, hasPathReferences } from "./path-expansion";
import { randomUUID } from "crypto";

const AGENT_INFO = {
  name: "vers-agent",
  version: "1.0.0",
};

const AGENT_CAPABILITIES: AgentCapabilities = {
  session: {
    modes: ["default", "plan"],
    streaming: true,
  },
  fileSystem: {
    read: true,
    write: true,
  },
  terminal: {
    create: true,
    interactive: false,
  },
  mcp: {
    tools: true,
  },
};

// Server state
let initialized = false;
let authenticated = false;
let currentSessionId: string | null = null;
let runningTaskId: string | null = null;

// SSE clients waiting for events
const sseClients: Set<(event: string, data: unknown) => void> = new Set();

function broadcastEvent(type: string, data: unknown): void {
  for (const send of sseClients) {
    send(type, data);
  }
}

// Map internal task events to ACP notification types
function mapEventToAcp(type: string, data: unknown): { type: string; data: unknown } | null {
  const d = data as Record<string, unknown>;

  switch (type) {
    case "started":
      return {
        type: "mode_update",
        data: { type: "mode_update", mode: "default" },
      };

    case "assistant_message":
      return {
        type: "content_chunk",
        data: { type: "content_chunk", text: d.text || "", final: true },
      };

    case "tool_use":
      return {
        type: "tool_call",
        data: {
          type: "tool_call",
          toolId: `tool-${Date.now()}`,
          toolName: d.toolName || "unknown",
          input: (d.toolInput || {}) as Record<string, unknown>,
        },
      };

    case "tool_result":
      return {
        type: "tool_result",
        data: {
          type: "tool_result",
          toolId: d.toolUseId || `tool-${Date.now()}`,
          success: true,
          output: d.content,
        },
      };

    case "completed":
      return {
        type: "completed",
        data: {
          type: "completed",
          durationMs: d.durationMs || 0,
          totalCostUsd: d.totalCostUsd || 0,
          numTurns: d.numTurns || 0,
          inputTokens: d.inputTokens || 0,
          outputTokens: d.outputTokens || 0,
        },
      };

    case "failed":
      return {
        type: "failed",
        data: { type: "failed", error: d.error || "Unknown error" },
      };

    case "cancelled":
      return {
        type: "cancelled",
        data: { type: "cancelled", reason: d.reason },
      };

    case "plan_update":
      // Plan update from agent - store in config and forward
      if (d.entries && Array.isArray(d.entries)) {
        setPlan(d.entries as PlanEntry[]);
      }
      return {
        type: "plan_update",
        data: { type: "plan_update", entries: d.entries || [] },
      };

    case "mode_update":
      // Mode update from agent
      if (d.mode === "plan" || d.mode === "default") {
        setSessionMode(d.mode);
      }
      return {
        type: "mode_update",
        data: { type: "mode_update", mode: d.mode },
      };

    default:
      return { type, data };
  }
}

// Send session notification to all SSE clients
function sendSessionNotification(type: string, data: unknown): void {
  const mapped = mapEventToAcp(type, data);
  if (!mapped) return;

  const notification: SessionNotificationParams = {
    sessionId: currentSessionId || "",
    type: mapped.type as SessionNotificationParams["type"],
    data: mapped.data as SessionNotificationParams["data"],
  };

  broadcastEvent("notification", notification);
}

// JSON-RPC method handlers
async function handleInitialize(params: InitializeParams): Promise<InitializeResult> {
  initialized = true;
  return {
    agentInfo: AGENT_INFO,
    capabilities: AGENT_CAPABILITIES,
  };
}

async function handleAuthenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
  if (params.method === "api_key" && params.credentials) {
    const state: KeysState = {
      keys: params.credentials,
      hash: computeKeysHash(params.credentials),
      detectedAt: new Date().toISOString(),
    };
    await saveKeys(state);

    if (params.credentials.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = params.credentials.ANTHROPIC_API_KEY;
    }
  }

  authenticated = true;
  return { success: true };
}

async function handleSessionNew(params: NewSessionParams): Promise<NewSessionResult> {
  resetSession();
  clearProjectDocsCache(); // Force re-read of CLAUDE.md, AGENT.md, etc.

  if (params.config) {
    if (params.config.model) {
      await setConfig({ model: params.config.model });
    }
    if (params.config.thinkingBudget !== undefined) {
      await setConfig({ thinkingBudget: params.config.thinkingBudget });
    }
  }

  currentSessionId = randomUUID();
  updateSession({ sessionId: currentSessionId });

  return { sessionId: currentSessionId };
}

async function handleSessionLoad(params: LoadSessionParams): Promise<LoadSessionResult> {
  currentSessionId = params.sessionId;
  updateSession({ sessionId: params.sessionId });

  return {
    sessionId: params.sessionId,
    resumed: true,
  };
}

async function handleSessionPrompt(params: PromptParams): Promise<PromptResult> {
  if (!currentSessionId) {
    throw new Error("No active session. Call session/new or session/load first.");
  }

  // Expand @path references in the prompt
  let promptText = params.text;
  if (hasPathReferences(promptText)) {
    const { expandedPrompt, refs, hasErrors } = await expandPrompt(promptText);
    promptText = expandedPrompt;

    // Log expanded paths for debugging
    if (refs.length > 0) {
      console.log(`Expanded ${refs.length} @path reference(s):`);
      for (const ref of refs) {
        if (ref.error) {
          console.log(`  ${ref.original} -> ERROR: ${ref.error}`);
        } else {
          console.log(`  ${ref.original} -> ${ref.absolutePath}`);
        }
      }
    }
  }

  // Convert ACP attachments to TaskAttachments
  const attachments = params.attachments?.map((a) => ({
    type: a.type,
    content: a.content,
    mimeType: a.mimeType,
  }));

  const task = taskStore.create(promptText, {}, attachments);
  runningTaskId = task.id;

  // Subscribe to task events and broadcast via SSE
  const unsubscribe = taskStore.subscribe(task.id, (event) => {
    sendSessionNotification(event.type, event.data);

    if (event.type === "completed" || event.type === "failed" || event.type === "cancelled") {
      runningTaskId = null;
    }
  });

  // Start task execution (don't await)
  runTask(task.id).catch((err) => {
    console.error(`Task ${task.id} failed:`, err);
    unsubscribe();
  });

  return { success: true };
}

async function handleSessionCancel(params: CancelParams): Promise<CancelResult> {
  if (!runningTaskId) {
    return { cancelled: false };
  }

  const cancelled = await cancelTask(runningTaskId);
  if (cancelled) {
    runningTaskId = null;
  }
  return { cancelled };
}

async function handleSessionSetMode(params: SetModeParams): Promise<SetModeResult> {
  // Only support default and plan modes
  if (params.mode !== "default" && params.mode !== "plan") {
    throw new Error(`Unsupported mode: ${params.mode}. Supported modes: default, plan`);
  }

  setSessionMode(params.mode);

  // Broadcast mode change to SSE clients
  sendSessionNotification("mode_update", { type: "mode_update", mode: params.mode });

  return { mode: params.mode };
}

// File system handlers for remote @path expansion
async function handleFsReadTextFile(
  filePath: string,
  cwd?: string
): Promise<{ content: string | null; error?: string; path: string }> {
  const { resolve, isAbsolute } = await import("path");
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(cwd || process.cwd(), filePath);

  try {
    const file = Bun.file(absolutePath);
    if (!(await file.exists())) {
      return { content: null, error: `File not found: ${absolutePath}`, path: absolutePath };
    }

    const content = await file.text();

    // Limit file size to prevent massive responses (1MB limit)
    if (content.length > 1024 * 1024) {
      return {
        content: content.slice(0, 1024 * 1024),
        error: `File truncated (>1MB)`,
        path: absolutePath,
      };
    }

    return { content, path: absolutePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: null, error: `Failed to read: ${msg}`, path: absolutePath };
  }
}

async function handleFsListDirectory(
  dirPath: string,
  cwd?: string
): Promise<{ entries: Array<{ name: string; type: "file" | "directory" }>; error?: string; path: string }> {
  const { resolve, isAbsolute, join } = await import("path");
  const { readdirSync, statSync } = await import("fs");
  const absolutePath = isAbsolute(dirPath) ? dirPath : resolve(cwd || process.cwd(), dirPath);

  try {
    const entries = readdirSync(absolutePath);
    const result = entries
      .filter((name) => !name.startsWith(".")) // Skip hidden files
      .slice(0, 100) // Limit to 100 entries
      .map((name) => {
        try {
          const stat = statSync(join(absolutePath, name));
          return { name, type: stat.isDirectory() ? "directory" as const : "file" as const };
        } catch {
          return { name, type: "file" as const };
        }
      });

    return { entries: result, path: absolutePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { entries: [], error: `Failed to list: ${msg}`, path: absolutePath };
  }
}

// Handle incoming JSON-RPC request
async function handleRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  try {
    let result: unknown;

    switch (method) {
      case AcpMethod.Initialize:
        result = await handleInitialize(params as InitializeParams);
        break;

      case AcpMethod.Authenticate:
        result = await handleAuthenticate(params as AuthenticateParams);
        break;

      case AcpMethod.SessionNew:
        if (!initialized) throw new Error("Not initialized");
        result = await handleSessionNew(params as NewSessionParams);
        break;

      case AcpMethod.SessionLoad:
        if (!initialized) throw new Error("Not initialized");
        result = await handleSessionLoad(params as LoadSessionParams);
        break;

      case AcpMethod.SessionPrompt:
        if (!initialized) throw new Error("Not initialized");
        result = await handleSessionPrompt(params as PromptParams);
        break;

      case AcpMethod.SessionCancel:
        if (!initialized) throw new Error("Not initialized");
        result = await handleSessionCancel(params as CancelParams);
        break;

      case AcpMethod.SessionSetMode:
        if (!initialized) throw new Error("Not initialized");
        result = await handleSessionSetMode(params as SetModeParams);
        break;

      case AcpMethod.SessionReloadDocs:
        if (!initialized) throw new Error("Not initialized");
        markDocsForReinjection();
        result = { success: true, message: "Project docs will be re-injected on next message" };
        break;

      case AcpMethod.SessionGetDocs:
        if (!initialized) throw new Error("Not initialized");
        result = {
          docs: getDocs(),
          store: getDocsStore(),
        };
        break;

      case AcpMethod.SessionSetDocs:
        if (!initialized) throw new Error("Not initialized");
        {
          const docsParams = params as { docs: Array<{ name: string; content: string; path?: string }> };
          if (!docsParams.docs || !Array.isArray(docsParams.docs)) {
            throw new Error("Invalid docs parameter");
          }
          const updatedDocs = await setDocs(docsParams.docs);
          clearProjectDocsCache(); // Force agent to reload from store
          result = {
            success: true,
            docs: updatedDocs,
            message: `Updated ${updatedDocs.length} doc(s)`,
          };
        }
        break;

      case AcpMethod.FsReadTextFile:
        // Read a file from the server's filesystem (for remote @path expansion)
        {
          const fsParams = params as { path: string; cwd?: string };
          if (!fsParams.path) {
            throw new Error("Missing path parameter");
          }
          result = await handleFsReadTextFile(fsParams.path, fsParams.cwd);
        }
        break;

      case AcpMethod.FsListDirectory:
        // List directory contents (for remote path autocomplete)
        {
          const fsParams = params as { path: string; cwd?: string };
          if (!fsParams.path) {
            throw new Error("Missing path parameter");
          }
          result = await handleFsListDirectory(fsParams.path, fsParams.cwd);
        }
        break;

      case AcpMethod.McpList:
        // List configured MCP servers
        {
          const servers = getMcpServers();
          result = { servers };
        }
        break;

      case AcpMethod.McpAdd:
        // Add an MCP server
        {
          const mcpParams = params as { name: string; config: McpServerConfig };
          if (!mcpParams.name) {
            throw new Error("Missing name parameter");
          }
          if (!mcpParams.config) {
            throw new Error("Missing config parameter");
          }
          const servers = await addMcpServer(mcpParams.name, mcpParams.config);
          result = { success: true, servers };
        }
        break;

      case AcpMethod.McpRemove:
        // Remove an MCP server
        {
          const mcpParams = params as { name: string };
          if (!mcpParams.name) {
            throw new Error("Missing name parameter");
          }
          const removed = await removeMcpServer(mcpParams.name);
          result = { success: removed, servers: getMcpServers() };
        }
        break;

      case AcpMethod.SessionGetMode:
        // Get current session mode
        result = { mode: getSessionMode() };
        break;

      case AcpMethod.SessionGetPlan:
        // Get current plan entries
        result = { plan: getPlan(), mode: getSessionMode() };
        break;

      case AcpMethod.SessionSetPlan:
        // Set plan entries
        {
          const planParams = params as { plan: PlanEntry[] };
          if (!planParams.plan || !Array.isArray(planParams.plan)) {
            throw new Error("Missing or invalid plan parameter");
          }
          const plan = setPlan(planParams.plan);
          // Broadcast plan update
          sendSessionNotification("plan_update", { type: "plan_update", entries: plan });
          result = { success: true, plan };
        }
        break;

      case AcpMethod.SessionClearPlan:
        // Clear the current plan
        clearPlan();
        sendSessionNotification("plan_update", { type: "plan_update", entries: [] });
        result = { success: true };
        break;

      default:
        return createErrorResponse(id, ErrorCode.MethodNotFound, `Unknown method: ${method}`);
    }

    return createResponse(id, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createErrorResponse(id, ErrorCode.InternalError, message);
  }
}

// Create the HTTP server
export function createHttpServer(port: number): { close: () => void } {
  const server = Bun.serve({
    port,
    idleTimeout: 255, // Max timeout in seconds (prevents hanging on shutdown)
    async fetch(req) {
      const url = new URL(req.url);

      // CORS headers
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      // JSON-RPC endpoint
      if (url.pathname === "/rpc" && req.method === "POST") {
        try {
          const body = await req.text();
          const message = parseMessage(body);

          if (!message || !("method" in message)) {
            return Response.json(
              createErrorResponse(null, ErrorCode.InvalidRequest, "Invalid JSON-RPC request"),
              { headers: corsHeaders }
            );
          }

          const response = await handleRpcRequest(message as JsonRpcRequest);
          return Response.json(response, { headers: corsHeaders });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json(
            createErrorResponse(null, ErrorCode.ParseError, message),
            { headers: corsHeaders }
          );
        }
      }

      // SSE endpoint for notifications
      if (url.pathname === "/events" && req.method === "GET") {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();

            // Send initial connection event
            controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

            // Register this client
            const send = (event: string, data: unknown) => {
              const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
              try {
                controller.enqueue(encoder.encode(payload));
              } catch {
                // Client disconnected
                sseClients.delete(send);
              }
            };

            sseClients.add(send);

            // Cleanup on close (handled by ReadableStream cancel)
          },
          cancel() {
            // Client disconnected - cleanup handled by try/catch in send
          },
        });

        return new Response(stream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }

      // Health check
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", initialized, sessionId: currentSessionId }, { headers: corsHeaders });
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    },
  });

  console.log(`ACP HTTP server listening on http://localhost:${server.port}`);

  return {
    close: () => server.stop(),
  };
}
