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

# ── Quick Workflows ───────────────────────────────────────────────────────────
# One command from clone to running
bootstrap: install build
    @echo "✓ Ready: source ~/.topos/.env && just run"

# Pre-commit sanity check
check: typecheck test

# Dashboard: is it running? who claimed it?
status port="9999":
    @echo "─── Server ───"
    @lsof -ti:{{port}} >/dev/null 2>&1 && echo "✓ Running on :{{port}} (PID $$(lsof -ti:{{port}}))" || echo "✗ Not running"
    @echo "─── Claim ───"
    @just claim-status
    @echo "─── Tokens ───"
    @just show-tokens 2>/dev/null | head -5 || true

# ── Session & Logs ────────────────────────────────────────────────────────────
sessions port="9999":
    curl -s http://localhost:{{port}}/sessions | jq

session port="9999":
    curl -s http://localhost:{{port}}/session | jq

logs port="9999":
    curl -N http://localhost:{{port}}/logs

metrics port="9999":
    curl -s http://localhost:{{port}}/metrics

# ── Ergonomic Shortcuts ───────────────────────────────────────────────────────
# Start server in background, then attach CLI (most common workflow)
up port="9999":
    @just kill-port {{port}} 2>/dev/null || true
    @echo "Starting server..."
    @source ~/.topos/.env && ./vers-agent --server &
    @sleep 1
    @source ~/.topos/.env && ./vers-agent --cli

# Quick prompt without interactive mode
ask prompt port="9999":
    @curl -s -X POST http://localhost:{{port}}/tasks \
        -H "Content-Type: application/json" \
        -d '{"prompt": "{{prompt}}"}' | jq -r '.id' | xargs -I {} curl -N http://localhost:{{port}}/tasks/{}/stream

# ── VT Testing (libghostty-vt) ────────────────────────────────────────────────
# Mitchell Hashimoto's libghostty-vt: zero-dep terminal parser from Ghostty
# Test suites: esctest2 (ThomasDickey), vttest (classic VT100)

vt:
    @echo "libghostty-vt test harness"
    @echo "  just vt-parse    - parse stdin through VT state machine"
    @echo "  just vt-esctest  - run esctest2 suite"
    @echo "  just vt-vttest   - run vttest compliance"
    @echo "  just vt-record   - record session for replay"
    @echo "  just vt-replay   - replay recorded session"

vt-parse:
    @echo "Parsing stdin through VT state machine..."
    @cat | od -c | head -50

vt-esctest:
    @which esctest.py >/dev/null 2>&1 && esctest.py --expected-terminal=ghostty || echo "Install: git clone https://github.com/ThomasDickey/esctest2"

vt-vttest:
    @which vttest >/dev/null 2>&1 && vttest || echo "Install: brew install vttest"

vt-record file="session.cast":
    @which asciinema >/dev/null 2>&1 && asciinema rec {{file}} || echo "Install: brew install asciinema"

vt-replay file="session.cast":
    @which asciinema >/dev/null 2>&1 && asciinema play {{file}} || echo "Install: brew install asciinema"

# ── Utilities ─────────────────────────────────────────────────────────────────
kill-port port="9999":
    @lsof -ti:{{port}} | xargs kill -9 2>/dev/null || echo "No process on :{{port}}"

nuke port="9999":
    @just kill-port {{port}}
    @just reset-claim
    @just clear-tokens
    @echo "☢️  Nuked. Run: source ~/.topos/.env && just run"

# Full reset including node_modules
pristine: clean
    rm -rf node_modules ~/.vers-agent
    @echo "Pristine. Run: just bootstrap"
