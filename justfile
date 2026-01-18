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
    bun test tests/agents tests/cli tests/client tests/core tests/fleet tests/integration tests/protocol tests/server tests/utils tests/session-sync.test.ts

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

# ── Chelsea Fleet (flox containerize) ─────────────────────────────────────────

# Build chelsea-compatible image via flox containerize (no custom Dockerfile)
chelsea image="vers-agent:chelsea":
    ./scripts/build-chelsea-image.sh {{image}}

# ── Security Image (Trail of Bits skills) ─────────────────────────────────────

# Build security image with Trail of Bits tooling
security image="vers-agent:security":
    docker build -f Dockerfile.security -t {{image}} .

# Push security image to registry
security-push image="vers-agent:security" registry="ghcr.io/bmorphism":
    #!/usr/bin/env bash
    set -e
    REMOTE_TAG="{{registry}}/{{image}}"
    echo "Tagging and pushing: $REMOTE_TAG"
    docker tag {{image}} "$REMOTE_TAG"
    docker push "$REMOTE_TAG"
    echo "✓ Pushed: $REMOTE_TAG"

# Build AND push security image (one command)
security-ship image="vers-agent:security" registry="ghcr.io/bmorphism":
    #!/usr/bin/env bash
    set -e
    echo "━━━ Building security image with Trail of Bits stack ━━━"
    just security {{image}}
    echo ""
    echo "━━━ Pushing to registry ━━━"
    just security-push {{image}} {{registry}}
    echo ""
    echo "✓ Security image shipped: {{registry}}/{{image}}"

# Run chelsea image locally
chelsea-run image="vers-agent:chelsea":
    docker run --rm -it -p 9999:9999 \
      -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
      -e VERS_VM_ID=local -e VERS_VM_NAME=local -e VERS_VM_TRIT=0 \
      {{image}}

# Deploy fleet (3 VMs with GF(3) trit balancing)
chelsea-fleet:
    docker compose -f docker-compose.fleet.yml up -d

chelsea-fleet-down:
    docker compose -f docker-compose.fleet.yml down -v

# Push chelsea image to ghcr.io
chelsea-push image="vers-agent:chelsea" registry="ghcr.io/bmorphism":
    #!/usr/bin/env bash
    set -e
    REMOTE_TAG="{{registry}}/{{image}}"
    echo "Tagging and pushing: $REMOTE_TAG"
    docker tag {{image}} "$REMOTE_TAG"
    docker push "$REMOTE_TAG"
    echo "✓ Pushed: $REMOTE_TAG"

# Build AND push chelsea image (one command)
chelsea-ship image="vers-agent:chelsea" registry="ghcr.io/bmorphism":
    #!/usr/bin/env bash
    set -e
    echo "━━━ Building chelsea image ━━━"
    just chelsea {{image}}
    echo ""
    echo "━━━ Pushing to registry ━━━"
    just chelsea-push {{image}} {{registry}}
    echo ""
    echo "✓ Image shipped: {{registry}}/{{image}}"

# ── Remote VMs ────────────────────────────────────────────────────────────────

# Build lean image (~165MB)
vers-vm-lean:
    docker build -f Dockerfile.lean -t vers-agent:lean .

# Provision VM with ngrok tunnel
vers-vm name="vers-acp" domain="":
    ./scripts/provision-vers-vm.sh {{name}} {{domain}}

# Deploy = lean build + provision
vers-vm-deploy name="vers-acp": vers-vm-lean
    just vers-vm {{name}}

# VM management: just vers-vm-ctl <name> <url|logs|shell|stop|rm>
vers-vm-ctl name cmd:
    #!/usr/bin/env bash
    case "{{cmd}}" in
      url)   docker exec {{name}} sh -c "curl -s localhost:4040/api/tunnels | grep -o 'https://[^\"]*ngrok[^\"]*' | head -1" ;;
      logs)  docker logs -f {{name}} ;;
      shell) docker exec -it {{name}} sh ;;
      stop)  docker stop {{name}} ;;
      rm)    docker rm -f {{name}}; docker volume rm "vers-agent-data-{{name}}" 2>/dev/null || true ;;
      *)     echo "Unknown: {{cmd}}. Use: url|logs|shell|stop|rm" ;;
    esac

# List running vers VMs
vers-vms:
    @docker ps --filter "name=vers" --format "table {{{{.Names}}\t{{{{.Status}}\t{{{{.Ports}}}}"

# Smart ngrok: check fleet ports, VM tunnels, or start local
ngrok port="9999":
    #!/usr/bin/env bash
    # Check fleet ngrok containers (host ports 4041-4043)
    for p in 4041 4042 4043; do
      URL=$(curl -s localhost:$p/api/tunnels 2>/dev/null | grep -o 'https://[^"]*' | head -1)
      [ -n "$URL" ] && echo "✓ :$p → $URL" && FOUND=1
    done
    [ -n "$FOUND" ] && exit 0
    # Check lean VM internal tunnel
    VM=$(docker ps --filter "name=vers" --format "{{{{.Names}}" | head -1)
    if [ -n "$VM" ]; then
      URL=$(docker exec "$VM" curl -s localhost:4040/api/tunnels 2>/dev/null | grep -o 'https://[^"]*' | head -1)
      [ -n "$URL" ] && echo "✓ $VM: $URL" && exit 0
    fi
    bun src/tunnel/index.ts {{port}}

# ngrok MCP edge management (for remote VMs)
ngrok-edge cmd id_or_domain="":
    #!/usr/bin/env bash
    case "{{cmd}}" in
      create) bun src/tunnel/mcp-integration.ts create "{{id_or_domain}}" ;;
      get)    bun src/tunnel/mcp-integration.ts get "{{id_or_domain}}" ;;
      delete) bun src/tunnel/mcp-integration.ts delete "{{id_or_domain}}" ;;
      *)      echo "Usage: just ngrok-edge <create|get|delete> <domain|id>" ;;
    esac

# Attach ngrok tunnel to existing running VM (reads ~/.topos/.env)
tunnel-attach name:
    #!/usr/bin/env bash
    set -e
    if ! docker ps --format '{{{{.Names}}' | grep -q "^{{name}}$"; then
        echo "Error: Container {{name}} not found"
        just vers-vms
        exit 1
    fi
    if [[ ! -f "$HOME/.topos/.env" ]]; then
        echo "Error: ~/.topos/.env not found. Add NGROK_AUTHTOKEN=xxx"
        exit 1
    fi
    TOKEN=$(grep -E '^NGROK_AUTHTOKEN=' "$HOME/.topos/.env" | cut -d= -f2 | tr -d '"' | tr -d "'")
    if [[ -z "$TOKEN" ]]; then
        echo "Error: NGROK_AUTHTOKEN not in ~/.topos/.env"
        exit 1
    fi
    echo "Attaching ngrok to {{name}}..."
    docker exec -d {{name}} sh -c "NGROK_AUTHTOKEN=$TOKEN ngrok http 9999 --traffic-policy-file /app/src/tunnel/policy.yml --log stdout"
    sleep 3
    just vers {{name}} url

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
