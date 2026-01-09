# vers-agent Lean Deployment Quickstart

> Deploy a minimal ACP server with ngrok tunnel in 3 commands

## Prerequisites

```bash
# 1. Ensure ~/.topos/.env exists with credentials
cat ~/.topos/.env
# Should contain:
# NGROK_AUTHTOKEN=your_ngrok_token
# ANTHROPIC_API_KEY=your_anthropic_key
```

## Deploy in 3 Steps

```bash
# 1. Build lean image (~165MB)
just docker-build-lean

# 2. Provision VM with tunnel
just provision-vm vers-production

# 3. Get tunnel URL
just vm-url vers-production
# → https://abc123.ngrok.io
```

That's it! Your ACP server is now accessible remotely.

## Connect Clients

### Claude Desktop

1. Open Claude Desktop
2. Settings → Integrations → Add Remote MCP Server
3. Paste the tunnel URL from step 3

### vers-agent CLI

```bash
vers-agent --remote https://abc123.ngrok.io
```

### Custom Client

```typescript
// Connect to remote ACP server
const client = new AcpClient("https://abc123.ngrok.io");
await client.initialize();
```

## VM Management

```bash
# List running VMs
just vm-list

# View logs
just vm-logs vers-production

# Stop VM
just vm-stop vers-production

# Remove VM
just vm-remove vers-production
```

## Custom Domain

If you have a reserved ngrok domain (e.g., `vers.ngrok.io`):

```bash
just provision-vm vers-production vers.ngrok.io
```

Your server will be available at `https://vers.ngrok.io`.

## What Gets Deployed

**Lean Image Components:**
- Alpine Linux 3.19 (~5MB)
- Bun runtime (~90MB)
- Claude Code binary (~50MB)
- ngrok binary (~20MB)
- **Total: ~165MB**

**vs Standard Image:**
- Ubuntu base (~70MB)
- Node.js + npm (~200MB)
- Build tools (~100MB)
- Multiple layers (~430MB+)
- **Total: ~800MB+**

## Security

The deployed VM includes:

✓ IP whitelisting (Anthropic + your IPs)  
✓ Token-based authentication  
✓ Rate limiting (100 req/min per IP)  
✓ TLS via ngrok  
✓ Non-root user  
✓ Health checks

## Architecture

```
Client (Claude/CLI)
      ↓ HTTPS
vers.ngrok.io
      ↓ HTTP (internal)
Docker Container
  ├── vers-agent server (port 9999)
  ├── ngrok client (tunnel)
  └── Claude Code (subprocess)
```

## Troubleshooting

### VM won't start

```bash
# Check logs
just vm-logs vers-production

# Common issues:
# - NGROK_AUTHTOKEN not set in ~/.topos/.env
# - Port 9999 already in use
# - Docker daemon not running
```

### Can't get tunnel URL

```bash
# Wait a few seconds for ngrok to connect
sleep 5 && just vm-url vers-production

# If still failing, check ngrok logs:
docker exec vers-production sh -c "curl http://localhost:4040/api/tunnels"
```

### Connection refused

```bash
# Check health
docker exec vers-production curl http://localhost:9999/health

# Verify ngrok is running
docker exec vers-production ps aux | grep ngrok
```

## Flox Alternative

For local development without Docker:

```bash
# Activate flox environment
flox activate

# Environment includes: bun, claude-code, ngrok, sqlite
# All binaries installed to ~/.local/bin
# NGROK_AUTHTOKEN loaded from ~/.topos/.env

# Run server
bun run start
```

## Next Steps

- Reserve a custom ngrok domain at https://dashboard.ngrok.com/domains
- Add more IPs to `src/tunnel/policy.yml`
- Set up monitoring/metrics (port 9999/metrics)
- Deploy multiple VMs for different teams
