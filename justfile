# vers-agent justfile | #c778ea | https://github.com/hdresearch/agent
#
# Auth: First client claims server → gets token → stored in ~/.vers-agent/
# Reset: `just nuke` or `just reset-claim` if locked out

default:
    @just --list

# ── Setup ─────────────────────────────────────────────────────────────────────
install:
    bun install

install-global:
    ./install.sh

uninstall-global:
    ./uninstall.sh

# ── Development ───────────────────────────────────────────────────────────────
dev:
    bun run dev

start:
    bun run start

typecheck:
    bun run typecheck

test:
    bun test

test-watch:
    bun test --watch

# ── Build ─────────────────────────────────────────────────────────────────────
build:
    bun run build

bundle:
    bun run build:bundle

clean:
    rm -rf dist/ vers-agent

rebuild: clean build

# ── Run (source ~/.topos/.env first) ──────────────────────────────────────────
run:
    ./vers-agent

agent:
    source ~/.topos/.env && ./vers-agent

cli:
    ./vers-agent --cli

server:
    ./vers-agent --server

continue:
    ./vers-agent --continue

remote url:
    ./vers-agent --url {{url}}

help:
    ./vers-agent --help

# ── Docker ────────────────────────────────────────────────────────────────────
docker-up:
    docker compose up --build

docker-down:
    docker compose down

# ── API (port default 9999) ───────────────────────────────────────────────────
health port="9999":
    curl -s http://localhost:{{port}}/health | jq

tasks port="9999":
    curl -s http://localhost:{{port}}/tasks | jq

tasks-auth token port="9999":
    curl -s -H "Authorization: Bearer {{token}}" http://localhost:{{port}}/tasks | jq

task prompt port="9999":
    curl -s -X POST http://localhost:{{port}}/tasks -H "Content-Type: application/json" -d '{"prompt": "{{prompt}}"}' | jq

stream id port="9999":
    curl -N http://localhost:{{port}}/tasks/{{id}}/stream

# ── Token/Claim Management ────────────────────────────────────────────────────
show-tokens:
    @cat ~/.vers-agent/tokens.json 2>/dev/null | jq || echo "No tokens"

claim-status:
    @sqlite3 ~/.vers-agent/auth.db "SELECT claimed_at, client_id FROM server_claim WHERE id = 1" 2>/dev/null || echo "No claim"

clear-tokens:
    @rm -f ~/.vers-agent/tokens.json && echo "Tokens cleared"

reset-claim:
    @sqlite3 ~/.vers-agent/auth.db "UPDATE server_claim SET claimed_at = NULL, token_hash = NULL, client_id = NULL WHERE id = 1" 2>/dev/null || true
    @echo "Claim reset - restart server"

server-fresh:
    VERS_AGENT_RESET_CLAIM=true ./vers-agent --server

# ── Utilities ─────────────────────────────────────────────────────────────────
kill-port port="9999":
    lsof -ti:{{port}} | xargs kill -9 2>/dev/null || echo "No process on :{{port}}"

nuke port="9999":
    @just kill-port {{port}}
    @just reset-claim
    @just clear-tokens
    @echo "Done. Run: source ~/.topos/.env && just run"
