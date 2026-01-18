# ngrok MCP Integration | #c778ea

> Programmatic tunnel management via Pipedream's ngrok MCP server

## Overview

vers-agent integrates with the [ngrok MCP server](https://mcp.pipedream.com/app/ngrok) to enable programmatic management of HTTPS edges, IP restrictions, and tunnel configuration.

## Architecture

```
┌─────────────────────────────────────────┐
│  vers-agent                             │
│  src/tunnel/mcp-integration.ts          │
└────────────┬────────────────────────────┘
             │ JSON-RPC over HTTPS
             ▼
┌─────────────────────────────────────────┐
│  Pipedream ngrok MCP Server             │
│  https://mcp.pipedream.net/v2           │
│  - create_https_edge                    │
│  - get_https_edge                       │
│  - update_https_edge                    │
│  - delete_https_edge                    │
└────────────┬────────────────────────────┘
             │ ngrok API
             ▼
┌─────────────────────────────────────────┐
│  ngrok API                              │
│  - Edges Management                     │
│  - IP Policies                          │
│  - TLS Configuration                    │
└─────────────────────────────────────────┘
```

## Setup

### 1. Get ngrok API Key

Visit [ngrok dashboard](https://dashboard.ngrok.com/api) and create an API key.

### 2. Add to ~/.topos/.env

```bash
echo "NGROK_API_KEY=your_api_key_here" >> ~/.topos/.env
```

### 3. Verify Setup

```bash
source ~/.topos/.env
bun src/tunnel/mcp-integration.ts
# Should show usage help
```

## CLI Usage

### Create an HTTPS Edge

```bash
# Create edge for vers.ngrok.io
bun src/tunnel/mcp-integration.ts create vers.ngrok.io

# Output:
# Created edge: {
#   id: "edghts_2abc123xyz",
#   hostports: ["vers.ngrok.io"],
#   description: "vers-agent ACP server",
#   metadata: "{\"app\":\"vers-agent\",\"protocol\":\"acp\",\"version\":\"1.0.0\"}"
# }
```

### Get Edge Details

```bash
bun src/tunnel/mcp-integration.ts get edghts_2abc123xyz

# Output: Full edge configuration including IP restrictions, TLS settings
```

### Delete an Edge

```bash
bun src/tunnel/mcp-integration.ts delete edghts_2abc123xyz

# Output: Deleted edge: edghts_2abc123xyz
```

## Justfile Recipes

```bash
# Create edge
just ngrok-mcp-create vers.ngrok.io

# Get edge details
just ngrok-mcp-get edghts_2abc123xyz

# Delete edge
just ngrok-mcp-delete edghts_2abc123xyz
```

## Programmatic API

### TypeScript Integration

```typescript
import {
  createVersAgentEdge,
  createHttpsEdge,
  getHttpsEdge,
  updateHttpsEdge,
  deleteHttpsEdge,
} from "./src/tunnel/mcp-integration";

// Create a vers-agent edge with metadata
const edge = await createVersAgentEdge("vers.ngrok.io", "Production ACP Server");

console.log(`Edge created: ${edge.id}`);
console.log(`Access at: https://${edge.hostports[0]}`);

// Get edge details
const details = await getHttpsEdge(edge.id);
console.log("Current configuration:", details);

// Update edge (e.g., change description)
await updateHttpsEdge({
  id: edge.id,
  description: "Updated: Production ACP Server v2",
});

// Clean up
await deleteHttpsEdge(edge.id);
```

### Custom Edge Configuration

```typescript
import { createHttpsEdge } from "./src/tunnel/mcp-integration";

const edge = await createHttpsEdge({
  description: "Custom ACP Server",
  hostports: ["custom.ngrok.io"],
  metadata: JSON.stringify({
    app: "custom-agent",
    environment: "staging",
    owner: "team-alpha",
  }),
});
```

## MCP Server Configuration

The ngrok MCP server configuration is in `src/tunnel/mcp-config.json`:

```json
{
  "mcpServers": {
    "ngrok": {
      "url": "https://mcp.pipedream.net/v2",
      "description": "ngrok MCP server for programmatic tunnel management",
      "tools": [
        "create_https_edge",
        "get_https_edge",
        "update_https_edge",
        "delete_https_edge"
      ],
      "env": {
        "NGROK_API_KEY": "${NGROK_API_KEY}"
      }
    }
  }
}
```

## Available Tools

### create_https_edge

Create a new HTTPS edge with custom configuration.

**Parameters:**
- `description` (optional) - Human-readable description
- `metadata` (optional) - JSON string with custom metadata
- `hostports` (optional) - Array of domain names

**Returns:** NgrokEdge object with `id`, `hostports`, etc.

### get_https_edge

Get full details of an existing edge.

**Parameters:**
- `id` (required) - Edge ID (format: `edghts_*`)

**Returns:** NgrokEdge object with all configuration

### update_https_edge

Update an existing edge's configuration.

**Parameters:**
- `id` (required) - Edge ID
- `description` (optional) - New description
- `metadata` (optional) - New metadata
- `hostports` (optional) - New domain names

**Returns:** Updated NgrokEdge object

### delete_https_edge

Delete an edge permanently.

**Parameters:**
- `id` (required) - Edge ID

**Returns:** void (success) or throws error

## Integration with VM Deployment

### Automated Edge Creation

Modify the provisioning script to create edges via MCP:

```bash
#!/usr/bin/env bash
# provision-vm-with-mcp.sh

set -euo pipefail

VM_NAME="${1:-vers-acp}"
DOMAIN="${2:-vers.ngrok.io}"

# 1. Create edge via MCP
echo "Creating ngrok edge for $DOMAIN..."
EDGE_JSON=$(bun src/tunnel/mcp-integration.ts create "$DOMAIN")
EDGE_ID=$(echo "$EDGE_JSON" | jq -r '.id')

echo "Edge created: $EDGE_ID"

# 2. Build and deploy VM
just docker-build-lean
just provision-vm "$VM_NAME" "$DOMAIN"

# 3. Store edge ID for cleanup
echo "$EDGE_ID" > "/tmp/vers-edge-${VM_NAME}.id"

echo "✓ VM deployed with MCP-managed edge"
echo "Edge ID: $EDGE_ID"
echo "Domain: https://$DOMAIN"
```

### Cleanup Script

```bash
#!/usr/bin/env bash
# cleanup-vm.sh

VM_NAME="${1:-vers-acp}"

# 1. Get edge ID
EDGE_ID=$(cat "/tmp/vers-edge-${VM_NAME}.id")

# 2. Stop and remove VM
just vm-remove "$VM_NAME"

# 3. Delete edge via MCP
bun src/tunnel/mcp-integration.ts delete "$EDGE_ID"

# 4. Clean up temp file
rm "/tmp/vers-edge-${VM_NAME}.id"

echo "✓ VM and edge cleaned up"
```

## Error Handling

```typescript
import { createVersAgentEdge } from "./src/tunnel/mcp-integration";

try {
  const edge = await createVersAgentEdge("vers.ngrok.io");
  console.log("Success:", edge.id);
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes("NGROK_API_KEY not set")) {
      console.error("Add NGROK_API_KEY to ~/.topos/.env");
    } else if (error.message.includes("MCP call failed")) {
      console.error("Network error or invalid API key");
    } else {
      console.error("Unexpected error:", error.message);
    }
  }
  process.exit(1);
}
```

## GF(3) Trit Conservation

MCP integration maintains trifold structure:

```
MINUS (-1):   deleteHttpsEdge (teardown)
ERGODIC (0):  getHttpsEdge, updateHttpsEdge (process)
PLUS (+1):    createHttpsEdge (emit)

Create/Delete pair: +1 + (-1) = 0 ✓
Get/Update loop: 0 + 0 = 0 ✓
```

## Security Considerations

### API Key Protection

✓ Store in `~/.topos/.env` (not in code)  
✓ Never commit to git  
✓ Use read-only API keys for get-only operations  
✓ Rotate keys periodically  

### Edge Metadata

Store deployment context in metadata for audit trail:

```typescript
const edge = await createHttpsEdge({
  hostports: ["vers.ngrok.io"],
  metadata: JSON.stringify({
    app: "vers-agent",
    version: "1.0.0",
    environment: "production",
    deployedBy: process.env.USER,
    deployedAt: new Date().toISOString(),
    gitCommit: process.env.GIT_COMMIT,
  }),
});
```

## Monitoring

Query all edges to monitor fleet:

```typescript
// List all vers-agent edges (requires listing API, not yet in MCP)
// For now, track edge IDs in a local database or file
const edgeIds = [
  "edghts_2abc123",
  "edghts_2def456",
  "edghts_2ghi789",
];

for (const id of edgeIds) {
  const edge = await getHttpsEdge(id);
  console.log(`${edge.hostports[0]}: ${edge.description}`);
}
```

## Next Steps

1. **Add to MCP Config** - Include ngrok in Claude Desktop MCP servers
2. **Automate Provisioning** - Use MCP in CI/CD pipelines
3. **Fleet Management** - Build dashboard for all edges
4. **IP Policy Integration** - Add IP restriction management via MCP
5. **Metrics** - Track edge creation/deletion via metrics endpoint

## References

- Pipedream ngrok MCP: https://mcp.pipedream.com/app/ngrok
- ngrok API Docs: https://ngrok.com/docs/api/
- MCP Spec: https://modelcontextprotocol.io/
- vers-agent Deployment: `docs/DEPLOYMENT.md`

## Sources

- [Using ngrok With Claude AI's MCP](https://ngrok.com/docs/using-ngrok-with/using-mcp)
- [ngrok MCP Server | Pipedream](https://mcp.pipedream.com/app/ngrok)
- [GitHub - ngrok/ngrok-javascript](https://github.com/ngrok/ngrok-javascript)
- [Supergateway - MCP stdio over SSE](https://github.com/supercorp-ai/supergateway)
