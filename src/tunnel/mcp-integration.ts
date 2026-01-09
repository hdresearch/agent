/**
 * ngrok MCP Integration
 * 
 * Programmatic tunnel management via Pipedream's ngrok MCP server
 * https://mcp.pipedream.com/app/ngrok
 */

import { logStream } from "../utils/log-stream";

const NGROK_MCP_URL = "https://mcp.pipedream.net/v2";

export interface NgrokEdge {
  id: string;
  description?: string;
  metadata?: string;
  hostports?: string[];
  backend?: {
    enabled: boolean;
    backend: {
      id: string;
      uri: string;
    };
  };
  ip_restriction?: {
    enabled: boolean;
    ip_policies: Array<{
      id: string;
      uri: string;
    }>;
  };
  mutual_tls?: {
    enabled: boolean;
    certificate_authorities: Array<{
      id: string;
      uri: string;
    }>;
  };
  tls_termination?: {
    enabled: boolean;
    min_version?: string;
  };
}

export interface CreateEdgeParams {
  description?: string;
  metadata?: string;
  hostports?: string[];
  [key: string]: unknown;
}

export interface UpdateEdgeParams {
  id: string;
  description?: string;
  metadata?: string;
  hostports?: string[];
  [key: string]: unknown;
}

/**
 * Call ngrok MCP server tool
 */
async function callMcpTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  // Try NGROK_API_KEY first, fall back to NGROK_AUTHTOKEN
  const apiKey = process.env.NGROK_API_KEY || process.env.NGROK_AUTHTOKEN;
  
  if (!apiKey) {
    throw new Error("NGROK_API_KEY or NGROK_AUTHTOKEN not set. Add to ~/.topos/.env");
  }

  const response = await fetch(NGROK_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: toolName,
        arguments: params,
      },
      id: Date.now(),
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP call failed: ${response.statusText}`);
  }

  const result = await response.json() as { error?: { message: string }; result: unknown };
  
  if (result.error) {
    throw new Error(`MCP error: ${result.error.message}`);
  }

  return result.result;
}

/**
 * Create an HTTPS Edge
 * https://ngrok.com/docs/api/resources/edges-https/
 */
export async function createHttpsEdge(
  params: CreateEdgeParams
): Promise<NgrokEdge> {
  logStream.debug("[ngrok-mcp] Creating HTTPS edge", params);
  
  const result = await callMcpTool("ngrok-create-https-edge", params);
  
  logStream.info("[ngrok-mcp] Created HTTPS edge", { id: (result as NgrokEdge).id });
  return result as NgrokEdge;
}

/**
 * Get HTTPS Edge details
 */
export async function getHttpsEdge(id: string): Promise<NgrokEdge> {
  logStream.debug("[ngrok-mcp] Getting HTTPS edge", { id });
  
  const result = await callMcpTool("ngrok-get-https-edge", { id });
  
  return result as NgrokEdge;
}

/**
 * Update an HTTPS Edge
 */
export async function updateHttpsEdge(
  params: UpdateEdgeParams
): Promise<NgrokEdge> {
  logStream.debug("[ngrok-mcp] Updating HTTPS edge", params);
  
  const result = await callMcpTool("ngrok-update-https-edge", params);
  
  logStream.info("[ngrok-mcp] Updated HTTPS edge", { id: params.id });
  return result as NgrokEdge;
}

/**
 * Delete an HTTPS Edge
 */
export async function deleteHttpsEdge(id: string): Promise<void> {
  logStream.debug("[ngrok-mcp] Deleting HTTPS edge", { id });
  
  await callMcpTool("ngrok-delete-https-edge", { id });
  
  logStream.info("[ngrok-mcp] Deleted HTTPS edge", { id });
}

/**
 * Create a vers-agent edge with policy
 */
export async function createVersAgentEdge(
  domain: string,
  description = "vers-agent ACP server"
): Promise<NgrokEdge> {
  return createHttpsEdge({
    description,
    hostports: [domain],
    metadata: JSON.stringify({
      app: "vers-agent",
      protocol: "acp",
      version: "1.0.0",
    }),
  });
}

// CLI usage
if (import.meta.main) {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case "create":
        {
          const domain = args[0];
          if (!domain) {
            console.error("Usage: bun src/tunnel/mcp-integration.ts create <domain>");
            process.exit(1);
          }
          const edge = await createVersAgentEdge(domain);
          console.log("Created edge:", edge);
        }
        break;

      case "get":
        {
          const id = args[0];
          if (!id) {
            console.error("Usage: bun src/tunnel/mcp-integration.ts get <id>");
            process.exit(1);
          }
          const edge = await getHttpsEdge(id);
          console.log("Edge:", edge);
        }
        break;

      case "delete":
        {
          const id = args[0];
          if (!id) {
            console.error("Usage: bun src/tunnel/mcp-integration.ts delete <id>");
            process.exit(1);
          }
          await deleteHttpsEdge(id);
          console.log("Deleted edge:", id);
        }
        break;

      default:
        console.log(`
Usage: bun src/tunnel/mcp-integration.ts <command> [args]

Commands:
  create <domain>   Create an HTTPS edge for vers-agent
  get <id>          Get edge details
  delete <id>       Delete an edge

Environment:
  NGROK_API_KEY     Your ngrok API key (or NGROK_AUTHTOKEN) (add to ~/.topos/.env)

Examples:
  bun src/tunnel/mcp-integration.ts create vers.ngrok.io
  bun src/tunnel/mcp-integration.ts get edghts_2abc123
  bun src/tunnel/mcp-integration.ts delete edghts_2abc123
        `);
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
