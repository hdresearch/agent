# vers-agent justfile

default:
    @just --list

# ── Setup ─────────────────────────────────────────────────────────────────────

# Install dependencies and git hooks
install:
    bun install
    @just setup-hooks

setup-hooks:
    @cp .githooks/pre-commit .git/hooks/pre-commit 2>/dev/null || true
    @chmod +x .git/hooks/pre-commit 2>/dev/null || true

# ── Development ───────────────────────────────────────────────────────────────

dev:
    bun run dev

build:
    bun run build

typecheck:
    bun run typecheck

test:
    bun test tests/agents tests/cli tests/client tests/core tests/integration tests/protocol tests/server tests/utils tests/session-sync.test.ts

check: typecheck test

# ── Run ───────────────────────────────────────────────────────────────────────

server:
    ./vers-agent --server

cli:
    ./vers-agent --cli

# ── Docker ────────────────────────────────────────────────────────────────────

docker-up:
    docker compose up --build

docker-down:
    docker compose down

# ── Lean VM Deployment ────────────────────────────────────────────────────────
# Build lean Docker image (~165MB vs ~800MB+ standard image)
docker-build-lean:
    docker build -f Dockerfile.lean -t vers-agent:lean .

# Provision a new VM with ngrok tunnel (reads ~/.topos/.env)
provision-vm name="vers-acp" domain="":
    ./scripts/provision-vers-vm.sh {{name}} {{domain}}

# Quick: build lean image and provision VM
deploy-lean name="vers-acp":
    just docker-build-lean
    just provision-vm {{name}}

# List running vers VMs
vm-list:
    @docker ps --filter "name=vers-" --format "table {{{{.Names}}\t{{{{.Status}}\t{{{{.Ports}}}}"

# Get ngrok URL for a running VM
vm-url name:
    @docker exec {{name}} sh -c "curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o 'https://[^\"]*ngrok[^\"]*' | head -1" || echo "No tunnel found"

# View VM logs
vm-logs name:
    docker logs -f {{name}}

# Stop a VM
vm-stop name:
    docker stop {{name}}

# Remove a VM and its data volume
vm-remove name:
    @docker rm -f {{name}} || true
    @docker volume rm "vers-agent-data-{{name}}" || true
    @echo "Removed {{name}} and its data volume"

# Connect to a VM's shell
vm-shell name:
    docker exec -it {{name}} sh

# ── ngrok MCP Integration ────────────────────────────────────────────────────
# Create an HTTPS edge via MCP (requires NGROK_API_KEY in ~/.topos/.env)
ngrok-mcp-create domain:
    bun src/tunnel/mcp-integration.ts create {{domain}}

# Get HTTPS edge details via MCP
ngrok-mcp-get id:
    bun src/tunnel/mcp-integration.ts get {{id}}

# Delete an HTTPS edge via MCP
ngrok-mcp-delete id:
    bun src/tunnel/mcp-integration.ts delete {{id}}

# ── Fleet Control ─────────────────────────────────────────────────────────────
# List all VMs in control plane
fleet-list:
    bun src/control/vm-registry.ts list

# Show fleet status summary
fleet-status:
    bun src/control/vm-registry.ts status

# Deploy a VM (requires NGROK_API_KEY)
fleet-deploy id domain:
    @echo "Deploying VM: {{id}} at {{domain}}"
    @echo "This will:"
    @echo "  1. Create ngrok edge via MCP"
    @echo "  2. Start Docker container"
    @echo "  3. Register in control plane"
    @echo ""
    @echo "Not yet fully implemented - see docs/CONTROL-PLANE.md"
    @echo "Use: just provision-vm {{id}} {{domain}}"

# Send prompt to remote VM
fleet-prompt id prompt:
    @echo "Sending prompt to {{id}}: {{prompt}}"
    @echo "Not yet implemented - see docs/CONTROL-PLANE.md"

# Destroy a VM
fleet-destroy id:
    @echo "Destroying VM: {{id}}"
    @echo "Not yet implemented - see docs/CONTROL-PLANE.md"

# ── Docker Testing ────────────────────────────────────────────────────────────
docker-test:
    #!/usr/bin/env bash
    set -e
    rm -f /tmp/.vers-agent-test-token
    docker compose -f docker-compose.test.yml down -v 2>/dev/null || true
    docker compose -f docker-compose.test.yml up -d --build
    echo "Waiting for server..."
    for i in {1..30}; do
        docker compose -f docker-compose.test.yml ps | grep -q healthy && break
        sleep 2
        [ $i -eq 30 ] && { docker compose -f docker-compose.test.yml logs; exit 1; }
    done
    bun run build
    DOCKER_SERVER_URL=http://localhost:19999 bun test tests/docker/
    docker compose -f docker-compose.test.yml down -v
    rm -f /tmp/.vers-agent-test-token

# ── Utilities ─────────────────────────────────────────────────────────────────

clean:
    rm -rf dist/ vers-agent

# Reset everything if something gets stuck
nuke port="9999":
    @lsof -ti:{{port}} | xargs kill -9 2>/dev/null || true
    @sqlite3 ~/.vers-agent/auth.db "UPDATE server_claim SET claimed_at = NULL, token_hash = NULL, client_id = NULL WHERE id = 1" 2>/dev/null || true
    @rm -f ~/.vers-agent/tokens.json
    @echo "Reset complete"

# Full reset including node_modules
pristine: clean
    rm -rf node_modules ~/.vers-agent
    @echo "Run: just install && just build"
