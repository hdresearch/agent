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

# ── gvt: libghostty-vt interactive test harness ───────────────────────────────
# One command: `just gvt` - interactive TUI for VT sequence testing
# Mitchell Hashimoto's libghostty-vt: zero-dep terminal parser from Ghostty

gvt:
    #!/usr/bin/env bash
    set -e
    
    # Colors
    R='\033[31m' G='\033[32m' Y='\033[33m' B='\033[34m' M='\033[35m' C='\033[36m'
    BOLD='\033[1m' DIM='\033[2m' RESET='\033[0m'
    
    clear
    echo -e "${M}${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${M}${BOLD}║  gvt - libghostty-vt interactive test harness                ║${RESET}"
    echo -e "${M}${BOLD}║  #c778ea                                                     ║${RESET}"
    echo -e "${M}${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
    echo
    
    while true; do
        echo -e "${C}${BOLD}[1]${RESET} SGR colors    ${C}[2]${RESET} Cursor moves   ${C}[3]${RESET} Screen modes"
        echo -e "${C}${BOLD}[4]${RESET} OSC titles    ${C}[5]${RESET} Mouse report   ${C}[6]${RESET} Bracketed paste"
        echo -e "${C}${BOLD}[7]${RESET} 256 colors    ${C}[8]${RESET} True color     ${C}[9]${RESET} Unicode/emoji"
        echo -e "${C}${BOLD}[v]${RESET} vttest        ${C}[e]${RESET} esctest        ${C}[r]${RESET} record session"
        echo -e "${C}${BOLD}[q]${RESET} quit"
        echo
        read -n1 -p $'\033[35m>\033[0m ' choice
        echo
        
        case $choice in
            1)
                echo -e "\n${BOLD}SGR (Select Graphic Rendition):${RESET}"
                echo -e "${BOLD}Bold${RESET} ${DIM}Dim${RESET} \033[3mItalic\033[0m \033[4mUnderline\033[0m \033[7mInverse\033[0m \033[9mStrike\033[0m"
                echo -e "${R}Red ${G}Green ${Y}Yellow ${B}Blue ${M}Magenta ${C}Cyan${RESET}"
                echo -e "\033[41m BG Red \033[42m BG Green \033[43m BG Yellow \033[0m"
                ;;
            2)
                echo -e "\n${BOLD}Cursor Movement:${RESET}"
                echo -e "Testing CUP (cursor position)..."
                printf '\033[5;10H<-- cursor at row 5, col 10'
                printf '\033[7;1H'
                echo -e "CSI sequences: CUU(A) CUD(B) CUF(C) CUB(D) CHA(G) VPA(d)"
                ;;
            3)
                echo -e "\n${BOLD}Screen Modes:${RESET}"
                echo "DECSCNM (reverse video): \033[?5h ON \033[?5l OFF"
                echo "DECTCEM (cursor visible): \033[?25l hidden \033[?25h shown"
                echo "Alt screen: \033[?1049h enter \033[?1049l leave"
                ;;
            4)
                echo -e "\n${BOLD}OSC (Operating System Command):${RESET}"
                printf '\033]0;gvt test title\007'
                echo "Set window title via OSC 0"
                printf '\033]10;?\007'
                echo "Query foreground color via OSC 10"
                ;;
            5)
                echo -e "\n${BOLD}Mouse Reporting:${RESET}"
                echo "Enabling X10 mouse mode... click anywhere"
                printf '\033[?9h'
                read -n6 -t3 mouse || true
                printf '\033[?9l'
                echo -e "\nMouse disabled. Raw: $(echo "$mouse" | od -c)"
                ;;
            6)
                echo -e "\n${BOLD}Bracketed Paste Mode:${RESET}"
                printf '\033[?2004h'
                echo "Enabled. Paste text (will be wrapped in ESC[200~ ... ESC[201~)"
                read -t5 pasted || true
                printf '\033[?2004l'
                echo "Received: $pasted"
                ;;
            7)
                echo -e "\n${BOLD}256 Color Palette:${RESET}"
                for i in {0..255}; do
                    printf '\033[48;5;%dm  ' $i
                    [ $(((i+1) % 32)) -eq 0 ] && printf '\033[0m\n'
                done
                printf '\033[0m'
                ;;
            8)
                echo -e "\n${BOLD}24-bit True Color:${RESET}"
                for r in 0 85 170 255; do
                    for g in 0 85 170 255; do
                        for b in 0 85 170 255; do
                            printf '\033[48;2;%d;%d;%dm ' $r $g $b
                        done
                    done
                    printf '\033[0m\n'
                done
                ;;
            9)
                echo -e "\n${BOLD}Unicode & Emoji:${RESET}"
                echo "Box drawing: ┌─┬─┐ │ ├─┼─┤ └─┴─┘"
                echo "Math: ∀ε>0 ∃δ>0 : |x-a|<δ ⟹ |f(x)-L|<ε"
                echo "Emoji: 🔴🟢🔵 👍👎 🚀💻🎯 🐱🐶🦊"
                echo "CJK: 你好世界 こんにちは 안녕하세요"
                echo "Width test: |あ| should be 2 cells"
                ;;
            v)
                echo -e "\n${BOLD}Running vttest...${RESET}"
                which vttest >/dev/null 2>&1 && vttest || echo "Install: brew install vttest"
                ;;
            e)
                echo -e "\n${BOLD}Running esctest...${RESET}"
                which esctest.py >/dev/null 2>&1 && esctest.py --expected-terminal=ghostty || echo "Install: git clone https://github.com/ThomasDickey/esctest2"
                ;;
            r)
                echo -e "\n${BOLD}Recording session...${RESET}"
                which asciinema >/dev/null 2>&1 && asciinema rec /tmp/gvt-session.cast || echo "Install: brew install asciinema"
                ;;
            q|Q)
                echo -e "\n${G}Bye!${RESET}"
                exit 0
                ;;
            *)
                echo -e "\n${R}Unknown option${RESET}"
                ;;
        esac
        echo
    done

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
