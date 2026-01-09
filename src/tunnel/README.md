# ngrok Tunnel Module

Expose vers-agent server via secure ngrok tunnel with IP whitelisting.

## Quick Start

```bash
# Install ngrok
brew install ngrok

# Authenticate (one-time)
ngrok config add-authtoken YOUR_TOKEN

# Start tunnel on default port
bun src/tunnel/index.ts

# With custom port
bun src/tunnel/index.ts 8080

# With custom domain (requires ngrok paid plan)
bun src/tunnel/index.ts 8080 mcp.yourdomain.com
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
