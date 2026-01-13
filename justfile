# vers-agent justfile

default:
    @just --list

# ── Setup ─────────────────────────────────────────────────────────────────────

# Install dependencies and git hooks
install:
    bun install --trust vers
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

# ── Nix ───────────────────────────────────────────────────────────────────────

# Update the node_modules hash in flake.nix
# Note: Local bun may differ from nixpkgs bun, so if nix build fails with
# hash mismatch, use the hash from the error message instead
nix-hash:
    #!/usr/bin/env bash
    set -e

    echo "Computing node_modules hash..."
    echo "(Note: If nix build fails with hash mismatch, use the hash from the error)"
    echo ""

    # Create temp directory and install deps
    tmpdir=$(mktemp -d)
    trap "rm -rf $tmpdir" EXIT

    cp package.json bun.lock "$tmpdir/"
    cd "$tmpdir"

    HOME=/tmp/bun-hash-home bun install --frozen-lockfile 2>/dev/null

    # Compute the hash of node_modules
    hash=$(nix --extra-experimental-features nix-command hash path --type sha256 --base64 node_modules)
    sri_hash="sha256-$hash"

    echo "New hash: $sri_hash"

    # Update flake.nix
    cd "{{justfile_directory()}}"
    sed -i.bak "s|outputHash = \"sha256-.*\";|outputHash = \"$sri_hash\";|" flake.nix
    rm -f flake.nix.bak

    echo "Updated flake.nix with new hash"

# Build with nix
nix-build:
    nix --extra-experimental-features 'nix-command flakes' build

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
