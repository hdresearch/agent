# ngrok Tunnel Module

Expose vers-agent server via secure ngrok tunnel with IP whitelisting.

## Quick Start

The tunnel module automatically reads `NGROK_AUTHTOKEN` from:
1. Function parameter (if provided)
2. Environment variable `NGROK_AUTHTOKEN`
3. `~/.topos/.env` file (recommended)

```bash
# Install ngrok
brew install ngrok

# Add token to ~/.topos/.env (one-time)
echo "NGROK_AUTHTOKEN=your_token_here" >> ~/.topos/.env

# Start tunnel on default port
bun src/tunnel/index.ts

# With custom port
bun src/tunnel/index.ts 8080

# With custom domain (requires ngrok paid plan)
bun src/tunnel/index.ts 8080 vers.ngrok.io
```

## IP Whitelisting

Edit `policy.yml` to add allowed IPs:

```yaml
on_http_request:
  - actions:
      - type: restrict-ips
        config:
          enforce: true
          allow:
            - YOUR_IP/32
            - 160.79.104.0/23  # Anthropic (Claude)
```

## Custom Domain Setup

1. Reserve domain in [ngrok dashboard](https://dashboard.ngrok.com/domains)
2. Add CNAME: `your-subdomain.yourdomain.com → your-subdomain.ngrok.io`
3. Run: `bun src/tunnel/index.ts 8765 your-subdomain.yourdomain.com`

## Integration with vers-agent

```typescript
import { startTunnel, stopTunnel } from "./tunnel";

// Start server + tunnel
const server = startServer({ port: 8765 });
const tunnel = await startTunnel({ 
  port: 8765, 
  domain: "mcp.yourdomain.com" 
});

console.log(`Remote URL: ${tunnel.url}`);
```

## Claude Remote MCP

Register `tunnel.url` in Claude:
- Settings → Profile → Integrations → Add more
- Paste the ngrok HTTPS URL

## Lean VM Deployment

Deploy a minimal vers-agent VM with automatic ngrok tunnel:

```bash
# Build lean image (~165MB vs ~800MB standard)
just docker-build-lean

# Provision VM (reads ~/.topos/.env for NGROK_AUTHTOKEN)
just provision-vm vers-production

# Quick deploy (build + provision)
just deploy-lean vers-production

# View tunnel URL
just vm-url vers-production

# Check logs
just vm-logs vers-production
```

### VM Management

```bash
# List all vers VMs
just vm-list

# Get tunnel URL for specific VM
just vm-url vers-production

# Stop a VM
just vm-stop vers-production

# Remove VM and data
just vm-remove vers-production

# Shell access
just vm-shell vers-production
```

### Custom Domain Setup

Reserve a domain in [ngrok dashboard](https://dashboard.ngrok.com/domains), then:

```bash
just provision-vm my-vm vers.ngrok.io
```

The VM will automatically use the custom domain.

## MCP Integration

vers-agent integrates with [Pipedream's ngrok MCP server](https://mcp.pipedream.com/app/ngrok) for programmatic tunnel management.

### Setup

Add your ngrok API key to `~/.topos/.env`:

```bash
echo "NGROK_API_KEY=your_api_key_here" >> ~/.topos/.env
```

### Usage

```bash
# Create an HTTPS edge for vers-agent
bun src/tunnel/mcp-integration.ts create vers.ngrok.io

# Get edge details
bun src/tunnel/mcp-integration.ts get edghts_2abc123

# Delete an edge
bun src/tunnel/mcp-integration.ts delete edghts_2abc123
```

### MCP Tools Available

- `create_https_edge` - Create a new HTTPS edge
- `get_https_edge` - Get edge details
- `update_https_edge` - Update edge configuration
- `delete_https_edge` - Delete an edge

### Programmatic API

```typescript
import {
  createVersAgentEdge,
  getHttpsEdge,
  updateHttpsEdge,
  deleteHttpsEdge,
} from "./tunnel/mcp-integration";

// Create edge with vers-agent metadata
const edge = await createVersAgentEdge("vers.ngrok.io");
console.log("Edge ID:", edge.id);

// Get details
const details = await getHttpsEdge(edge.id);

// Clean up
await deleteHttpsEdge(edge.id);
```
