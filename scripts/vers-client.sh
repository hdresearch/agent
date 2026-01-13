#!/bin/bash
# vers-client.sh - CLI client for vers-agent HTTP API
# Usage: ./scripts/vers-client.sh <command> [args]

set -e

HOST="${VERS_HOST:-localhost}"
PORT="${VERS_PORT:-9999}"
BASE_URL="http://${HOST}:${PORT}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# JSON-RPC helper
rpc() {
  local method="$1"
  local params="$2"
  if [ -z "$params" ]; then
    params="{}"
  fi
  curl -sX POST "${BASE_URL}/rpc" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"${method}\",\"params\":${params}}"
}

# Commands
case "${1:-help}" in
  # Health & Status
  health)
    curl -s "${BASE_URL}/health" | jq .
    ;;

  status)
    echo -e "${BLUE}Health:${NC}"
    curl -s "${BASE_URL}/health" | jq .
    echo -e "\n${BLUE}Config:${NC}"
    rpc "config/get" | jq .result.config
    ;;

  # Session Management
  init)
    echo -e "${BLUE}Initializing...${NC}"
    rpc "initialize" | jq .
    ;;

  new|new-session)
    echo -e "${BLUE}Creating new session...${NC}"
    rpc "session/new" | jq .
    ;;

  sessions|list-sessions)
    rpc "session/list" | jq .result
    ;;

  # Prompts
  prompt|p)
    shift
    text="$*"
    if [ -z "$text" ]; then
      echo -e "${RED}Usage: vers-client.sh prompt <text>${NC}"
      exit 1
    fi
    # Escape the text for JSON (use printf to avoid trailing newline)
    escaped=$(printf '%s' "$text" | jq -Rs .)
    echo -e "${BLUE}Sending prompt:${NC} $text"
    rpc "session/prompt" "{\"text\":${escaped}}" | jq .
    ;;

  # Cancel
  cancel)
    echo -e "${YELLOW}Cancelling...${NC}"
    rpc "session/cancel" | jq .
    ;;

  # Run prompt and stream output (combined)
  run|r)
    shift
    text="$*"
    if [ -z "$text" ]; then
      echo -e "${RED}Usage: vers-client.sh run <prompt>${NC}"
      exit 1
    fi

    # Send the prompt first
    escaped=$(printf '%s' "$text" | jq -Rs .)
    echo -e "${BLUE}> ${text}${NC}\n"
    rpc "session/prompt" "{\"text\":${escaped}}" > /dev/null

    # Stream events until completed/failed
    curl -sN "${BASE_URL}/events" | while IFS= read -r line; do
      if [[ "$line" == data:* ]]; then
        json="${line#data: }"
        type=$(echo "$json" | jq -r '.data.type // empty' 2>/dev/null)
        case "$type" in
          content_chunk)
            text_chunk=$(echo "$json" | jq -r '.data.text // empty' 2>/dev/null)
            printf '%s' "$text_chunk"
            ;;
          tool_call)
            tool=$(echo "$json" | jq -r '.data.toolName // .data.title // empty' 2>/dev/null)
            echo -e "\n${YELLOW}[Tool: ${tool}]${NC}"
            ;;
          tool_result)
            echo -e "${GREEN}[Done]${NC}"
            ;;
          completed)
            echo -e "\n${GREEN}[Completed]${NC}\n"
            # Kill the curl process to exit the pipe
            pkill -P $$ curl 2>/dev/null
            break
            ;;
          failed)
            err=$(echo "$json" | jq -r '.data.error // empty' 2>/dev/null)
            echo -e "\n${RED}[Failed: ${err}]${NC}\n"
            pkill -P $$ curl 2>/dev/null
            break
            ;;
        esac
      fi
    done
    ;;

  # Config
  config)
    rpc "config/get" | jq .result.config
    ;;

  yolo|auto-approve)
    echo -e "${GREEN}Enabling auto-approve...${NC}"
    rpc "config/set" '{"autoApprovePermissions":true}' | jq .result.config
    ;;

  no-yolo|manual-approve)
    echo -e "${YELLOW}Disabling auto-approve...${NC}"
    rpc "config/set" '{"autoApprovePermissions":false}' | jq .result.config
    ;;

  set-model)
    model="${2:-opus}"
    echo -e "${BLUE}Setting model to ${model}...${NC}"
    rpc "config/set" "{\"model\":\"${model}\"}" | jq .result.config
    ;;

  # Queue
  queue)
    rpc "queue/list" | jq .result
    ;;

  queue-add|enqueue)
    shift
    text="$*"
    if [ -z "$text" ]; then
      echo -e "${RED}Usage: vers-client.sh queue-add <text>${NC}"
      exit 1
    fi
    escaped=$(printf '%s' "$text" | jq -Rs .)
    rpc "queue/enqueue" "{\"text\":${escaped}}" | jq .
    ;;

  queue-clear)
    rpc "queue/clear" | jq .
    ;;

  # Events (SSE stream)
  events)
    echo -e "${BLUE}Watching raw events (Ctrl+C to stop)...${NC}"
    curl -sN "${BASE_URL}/events"
    ;;

  # Watch streaming response (pretty printed)
  watch|stream)
    curl -sN "${BASE_URL}/events" | while IFS= read -r line; do
      # Skip empty lines and "event:" lines
      if [[ "$line" == data:* ]]; then
        json="${line#data: }"
        # Extract notification type and content
        type=$(echo "$json" | jq -r '.data.type // empty' 2>/dev/null)
        case "$type" in
          content_chunk)
            # Print text chunks without newline (streaming effect)
            text=$(echo "$json" | jq -r '.data.text // empty' 2>/dev/null)
            printf '%s' "$text"
            ;;
          tool_call)
            tool=$(echo "$json" | jq -r '.data.toolName // .data.title // empty' 2>/dev/null)
            echo -e "\n${YELLOW}[Tool: ${tool}]${NC}"
            ;;
          tool_result)
            echo -e "${GREEN}[Done]${NC}"
            ;;
          completed)
            echo -e "\n${GREEN}[Completed]${NC}\n"
            ;;
          failed)
            err=$(echo "$json" | jq -r '.data.error // empty' 2>/dev/null)
            echo -e "\n${RED}[Failed: ${err}]${NC}\n"
            ;;
        esac
      fi
    done
    ;;

  # Logs
  logs)
    level="${2:-info}"
    echo -e "${BLUE}Streaming logs (level: ${level}, Ctrl+C to stop)...${NC}"
    curl -sN "${BASE_URL}/logs?level=${level}"
    ;;

  # Agents
  agents)
    rpc "agent/list" | jq .result
    ;;

  agent-status)
    rpc "agent/status" | jq .result
    ;;

  # Skills
  skills)
    rpc "skill/list" | jq .result
    ;;

  # VMs
  vms)
    rpc "vm/list" | jq .result
    ;;

  vm-create)
    task="${2:-}"
    if [ -n "$task" ]; then
      escaped=$(printf '%s' "$task" | jq -Rs .)
      rpc "vm/create" "{\"task\":${escaped}}" | jq .result
    else
      rpc "vm/create" | jq .result
    fi
    ;;

  vm-run)
    shift
    prompt="$*"
    if [ -z "$prompt" ]; then
      echo -e "${RED}Usage: vers-client.sh vm-run <prompt>${NC}"
      exit 1
    fi
    escaped=$(printf '%s' "$prompt" | jq -Rs .)
    echo -e "${BLUE}Running on all VMs:${NC} $prompt"
    rpc "vm/run" "{\"prompt\":${escaped}}" | jq .result
    ;;

  # Help
  help|--help|-h|"")
    echo "vers-client.sh - CLI client for vers-agent"
    echo ""
    echo "Environment:"
    echo "  VERS_HOST  Server host (default: localhost)"
    echo "  VERS_PORT  Server port (default: 9999)"
    echo ""
    echo "Commands:"
    echo "  health              Check server health"
    echo "  status              Show health + config"
    echo ""
    echo "  init                Initialize connection"
    echo "  new                 Create new session"
    echo "  sessions            List sessions"
    echo ""
    echo "  run <text>          Send prompt and stream response (recommended)"
    echo "  prompt <text>       Send a prompt (returns immediately)"
    echo "  watch               Watch streaming response"
    echo "  cancel              Cancel running task"
    echo ""
    echo "  config              Show current config"
    echo "  yolo                Enable auto-approve permissions"
    echo "  no-yolo             Disable auto-approve permissions"
    echo "  set-model <model>   Set model (opus/sonnet/haiku)"
    echo ""
    echo "  queue               List queued prompts"
    echo "  queue-add <text>    Add prompt to queue"
    echo "  queue-clear         Clear the queue"
    echo ""
    echo "  events              Watch SSE event stream"
    echo "  logs [level]        Stream logs (debug/info/warn/error)"
    echo ""
    echo "  agents              List available agents"
    echo "  agent-status        Show current agent status"
    echo ""
    echo "  skills              List skills"
    echo ""
    echo "  vms                 List VMs"
    echo "  vm-create [task]    Create a new VM"
    echo "  vm-run <prompt>     Run prompt on all VMs"
    echo ""
    echo "Examples:"
    echo "  ./scripts/vers-client.sh run 'say hello'      # Send + stream response"
    echo "  ./scripts/vers-client.sh watch &              # Background: watch output"
    echo "  ./scripts/vers-client.sh prompt 'fix bug'     # Send without waiting"
    echo "  ./scripts/vers-client.sh yolo                 # Enable auto-approve"
    ;;

  *)
    echo -e "${RED}Unknown command: $1${NC}"
    echo "Run './scripts/vers-client.sh help' for usage"
    exit 1
    ;;
esac
