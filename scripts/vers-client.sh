#!/bin/bash
# vers-client.sh - CLI client for vers-agent HTTP API
# Usage: ./scripts/vers-client.sh <command> [args]

set -e

HOST="${VERS_HOST:-localhost}"
PORT="${VERS_PORT:-9999}"
BASE_URL="http://${HOST}:${PORT}"

# Get auth token (from env or tokens.json)
get_token() {
  if [ -n "${VERS_TOKEN:-}" ]; then
    echo "$VERS_TOKEN"
    return
  fi
  # Compute hash of server URL (matching token-store.ts)
  local url_hash=$(echo -n "${BASE_URL}" | tr '[:upper:]' '[:lower:]' | sed 's/\/\+$//' | shasum -a 256 | cut -c1-16)
  local tokens_file="$HOME/.vers-agent/tokens.json"
  if [ -f "$tokens_file" ]; then
    jq -r ".tokens[\"${url_hash}\"] // empty" "$tokens_file" 2>/dev/null
  fi
}
AUTH_TOKEN=$(get_token)

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
    params='{}'
  fi
  local body="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"${method}\",\"params\":${params}}"
  if [ -n "$AUTH_TOKEN" ]; then
    printf '%s' "$body" | curl -sX POST "${BASE_URL}/rpc" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${AUTH_TOKEN}" \
      -d @-
  else
    printf '%s' "$body" | curl -sX POST "${BASE_URL}/rpc" \
      -H "Content-Type: application/json" \
      -d @-
  fi
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

  skill)
    name="${2:-}"
    if [ -z "$name" ]; then
      echo -e "${RED}Usage: vers-client.sh skill <name> [args]${NC}"
      exit 1
    fi
    shift 2
    args="$*"
    escaped_name=$(printf '%s' "$name" | jq -Rs .)
    if [ -n "$args" ]; then
      escaped_args=$(printf '%s' "$args" | jq -Rs .)
      rpc "skill/invoke" "{\"name\":${escaped_name},\"args\":${escaped_args}}" | jq .
    else
      rpc "skill/invoke" "{\"name\":${escaped_name}}" | jq .
    fi
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

  vm-exec)
    vmId="${2:-}"
    shift 2 2>/dev/null
    cmd="$*"
    if [ -z "$vmId" ] || [ -z "$cmd" ]; then
      echo -e "${RED}Usage: vers-client.sh vm-exec <vmId> <command>${NC}"
      exit 1
    fi
    escaped_cmd=$(printf '%s' "$cmd" | jq -Rs .)
    escaped_vmId=$(printf '%s' "$vmId" | jq -Rs .)
    rpc "vm/execute" "{\"vmId\":${escaped_vmId},\"command\":${escaped_cmd}}" | jq .result
    ;;

  vm-upload)
    vmId="${2:-}"
    localPath="${3:-}"
    remotePath="${4:-}"
    if [ -z "$vmId" ] || [ -z "$localPath" ] || [ -z "$remotePath" ]; then
      echo -e "${RED}Usage: vers-client.sh vm-upload <vmId> <localPath> <remotePath>${NC}"
      exit 1
    fi
    escaped_vmId=$(printf '%s' "$vmId" | jq -Rs .)
    escaped_local=$(printf '%s' "$localPath" | jq -Rs .)
    escaped_remote=$(printf '%s' "$remotePath" | jq -Rs .)
    echo -e "${BLUE}Uploading${NC} $localPath -> $remotePath on $vmId"
    rpc "vm/upload" "{\"vmId\":${escaped_vmId},\"localPath\":${escaped_local},\"remotePath\":${escaped_remote}}" | jq .result
    ;;

  vm-events)
    # Polling endpoint for VM events
    afterSeq="${2:-0}"
    vmIds="${3:-}"
    if [ -n "$vmIds" ]; then
      escaped_vmIds=$(printf '%s' "$vmIds" | jq -Rs 'split(",")')
      rpc "vm/events" "{\"afterSeq\":${afterSeq},\"vmIds\":${escaped_vmIds}}" | jq .result
    else
      rpc "vm/events" "{\"afterSeq\":${afterSeq}}" | jq .result
    fi
    ;;

  vm-watch)
    # SSE stream of all VM events - pretty printed with VM names
    vmIds="${2:-}"

    if [ -n "$vmIds" ]; then
      echo -e "${BLUE}Watching VM events for: ${vmIds} (Ctrl+C to stop)...${NC}"
      url="${BASE_URL}/events/vms?vmIds=${vmIds}"
    else
      echo -e "${BLUE}Watching all VM events (Ctrl+C to stop)...${NC}"
      url="${BASE_URL}/events/vms"
    fi

    # Track current VM for streaming continuity
    CURRENT_VM=""

    curl -sN "$url" | while IFS= read -r line; do
      if [[ "$line" == data:* ]]; then
        json="${line#data: }"
        vmId=$(echo "$json" | jq -r '.vmId // empty' 2>/dev/null)
        type=$(echo "$json" | jq -r '.event.data.type // .event.type // empty' 2>/dev/null)
        shortVm="${vmId:0:8}"

        # Simple color based on first char of vmId
        case "${vmId:0:1}" in
          [0-3]) vmColor="${BLUE}" ;;
          [4-7]) vmColor="${GREEN}" ;;
          [8-b]) vmColor="${YELLOW}" ;;
          *) vmColor='\033[0;36m' ;;  # cyan
        esac

        case "$type" in
          content_chunk)
            text=$(echo "$json" | jq -r '.event.data.text // empty' 2>/dev/null)
            if [ -n "$text" ]; then
              # Print VM prefix if switching VMs
              if [ "$CURRENT_VM" != "$vmId" ]; then
                [ -n "$CURRENT_VM" ] && echo ""
                printf "${vmColor}[${shortVm}]${NC} "
                CURRENT_VM="$vmId"
              fi
              printf '%s' "$text"
            fi
            ;;
          tool_call)
            tool=$(echo "$json" | jq -r '.event.data.toolName // .event.data.title // empty' 2>/dev/null)
            echo -e "\n${vmColor}[${shortVm}]${NC} ${YELLOW}⚙ ${tool}${NC}"
            CURRENT_VM=""
            ;;
          tool_result)
            echo -e "${vmColor}[${shortVm}]${NC} ${GREEN}✓${NC}"
            ;;
          completed)
            echo -e "\n${vmColor}[${shortVm}]${NC} ${GREEN}✓ Done${NC}"
            CURRENT_VM=""
            ;;
          failed)
            err=$(echo "$json" | jq -r '.event.data.error // empty' 2>/dev/null)
            echo -e "\n${vmColor}[${shortVm}]${NC} ${RED}✗ Failed: ${err}${NC}"
            CURRENT_VM=""
            ;;
        esac
      fi
    done
    ;;

  vm-outputs)
    # Get outputs from a VM
    vmId="${2:-}"
    limit="${3:-}"
    if [ -z "$vmId" ]; then
      echo -e "${RED}Usage: vers-client.sh vm-outputs <vmId> [limit]${NC}"
      exit 1
    fi
    escaped_vmId=$(printf '%s' "$vmId" | jq -Rs .)
    if [ -n "$limit" ]; then
      rpc "vm/outputs" "{\"vmId\":${escaped_vmId},\"limit\":${limit}}" | jq .result
    else
      rpc "vm/outputs" "{\"vmId\":${escaped_vmId}}" | jq .result
    fi
    ;;

  vm-status|vm-outputs-all)
    # Get status and last message from all VMs
    limit="${2:-1}"
    rpc "vm/outputs/all" "{\"limit\":${limit}}" | jq .result
    ;;

  vm-sync)
    # Sync local changes to VM using git bundle
    vmId="${2:-}"
    baseCommit="${3:-${VERS_GOLDEN_COMMIT_ID:-}}"

    if [ -z "$vmId" ]; then
      echo -e "${RED}Usage: vers-client.sh vm-sync <vmId> [baseCommit]${NC}"
      echo -e "  baseCommit: defaults to VERS_GOLDEN_COMMIT_ID env var"
      exit 1
    fi

    if [ -z "$baseCommit" ]; then
      echo -e "${RED}Error: No base commit specified and VERS_GOLDEN_COMMIT_ID not set${NC}"
      echo -e "Provide a base commit or set VERS_GOLDEN_COMMIT_ID"
      exit 1
    fi

    # Create bundle from base commit to HEAD
    bundlePath="/tmp/vers-sync-${vmId}.bundle"
    echo -e "${BLUE}Creating git bundle from ${baseCommit:0:8}..HEAD${NC}"

    if ! git bundle create "$bundlePath" "${baseCommit}..HEAD" 2>/dev/null; then
      echo -e "${RED}Failed to create bundle. Is ${baseCommit:0:8} an ancestor of HEAD?${NC}"
      exit 1
    fi

    bundleSize=$(du -h "$bundlePath" | cut -f1)
    commitCount=$(git rev-list "${baseCommit}..HEAD" | wc -l | tr -d ' ')
    echo -e "${GREEN}Bundle created: ${bundleSize} (${commitCount} commits)${NC}"

    # Upload bundle to VM
    echo -e "${BLUE}Uploading bundle to VM...${NC}"
    escaped_vmId=$(printf '%s' "$vmId" | jq -Rs .)
    rpc "vm/upload" "{\"vmId\":${escaped_vmId},\"localPath\":\"${bundlePath}\",\"remotePath\":\"/tmp/sync.bundle\"}" > /dev/null

    # Apply bundle on VM (ensure git is ready, force checkout)
    echo -e "${BLUE}Applying bundle on VM...${NC}"
    applyCmd='date -s "$(curl -sI google.com 2>/dev/null | grep -i date | cut -d'"'"' '"'"' -f2-)" 2>/dev/null; which git >/dev/null || (apt-get update -qq && apt-get install -y -qq git); git config --global --add safe.directory /root/vers-agent 2>/dev/null; cd /root/vers-agent && git checkout -f main 2>/dev/null || git checkout -f master 2>/dev/null || true && git branch -D synced 2>/dev/null || true && git fetch /tmp/sync.bundle HEAD:synced && git checkout -f synced && rm /tmp/sync.bundle'
    escaped_cmd=$(printf '%s' "$applyCmd" | jq -Rs .)
    result=$(rpc "vm/execute" "{\"vmId\":${escaped_vmId},\"command\":${escaped_cmd}}")

    exitCode=$(echo "$result" | jq -r '.result.exitCode // 1')
    if [ "$exitCode" = "0" ]; then
      echo -e "${GREEN}Sync complete!${NC}"
    else
      echo -e "${RED}Sync failed:${NC}"
      echo "$result" | jq -r '.result.stderr // .result.stdout // "Unknown error"'
      exit 1
    fi

    # Cleanup local bundle
    rm -f "$bundlePath"
    ;;

  vm-sync-all)
    # Sync local changes to ALL VMs using git bundle
    baseCommit="${2:-${VERS_GOLDEN_COMMIT_ID:-}}"

    if [ -z "$baseCommit" ]; then
      echo -e "${RED}Error: No base commit specified and VERS_GOLDEN_COMMIT_ID not set${NC}"
      echo -e "Usage: vers-client.sh vm-sync-all [baseCommit]"
      exit 1
    fi

    # Get list of VM IDs
    vmIds=$(rpc "vm/list" | jq -r '.result.vms[].vmId // empty' 2>/dev/null)
    if [ -z "$vmIds" ]; then
      echo -e "${YELLOW}No VMs found${NC}"
      exit 0
    fi

    vmCount=$(echo "$vmIds" | wc -l | tr -d ' ')
    echo -e "${BLUE}Syncing to ${vmCount} VMs...${NC}"

    # Create bundle once
    bundlePath="/tmp/vers-sync-all.bundle"
    echo -e "${BLUE}Creating git bundle from ${baseCommit:0:8}..HEAD${NC}"

    if ! git bundle create "$bundlePath" "${baseCommit}..HEAD" 2>/dev/null; then
      echo -e "${RED}Failed to create bundle. Is ${baseCommit:0:8} an ancestor of HEAD?${NC}"
      exit 1
    fi

    bundleSize=$(du -h "$bundlePath" | cut -f1)
    commitCount=$(git rev-list "${baseCommit}..HEAD" | wc -l | tr -d ' ')
    echo -e "${GREEN}Bundle created: ${bundleSize} (${commitCount} commits)${NC}"

    # Sync to each VM
    success=0
    failed=0
    for vmId in $vmIds; do
      shortId="${vmId:0:8}"
      echo -e "${BLUE}[${shortId}] Uploading...${NC}"
      escaped_vmId=$(printf '%s' "$vmId" | jq -Rs .)

      # Upload
      rpc "vm/upload" "{\"vmId\":${escaped_vmId},\"localPath\":\"${bundlePath}\",\"remotePath\":\"/tmp/sync.bundle\"}" > /dev/null

      # Apply (ensure git is ready, force checkout)
      applyCmd='date -s "$(curl -sI google.com 2>/dev/null | grep -i date | cut -d'"'"' '"'"' -f2-)" 2>/dev/null; which git >/dev/null || (apt-get update -qq && apt-get install -y -qq git); git config --global --add safe.directory /root/vers-agent 2>/dev/null; cd /root/vers-agent && git checkout -f main 2>/dev/null || git checkout -f master 2>/dev/null || true && git branch -D synced 2>/dev/null || true && git fetch /tmp/sync.bundle HEAD:synced && git checkout -f synced && rm /tmp/sync.bundle'
      escaped_cmd=$(printf '%s' "$applyCmd" | jq -Rs .)
      result=$(rpc "vm/execute" "{\"vmId\":${escaped_vmId},\"command\":${escaped_cmd}}")
      exitCode=$(echo "$result" | jq -r '.result.exitCode // 1')

      if [ "$exitCode" = "0" ]; then
        echo -e "${GREEN}[${shortId}] Synced${NC}"
        success=$((success + 1))
      else
        echo -e "${RED}[${shortId}] Failed${NC}"
        failed=$((failed + 1))
      fi
    done

    # Cleanup
    rm -f "$bundlePath"

    echo ""
    echo -e "${GREEN}Done: ${success} synced${NC}${failed:+, ${RED}${failed} failed${NC}}"
    ;;

  vm-eval)
    # Evaluate a VM's project (run build, test, lint, typecheck)
    vmId="${2:-}"
    if [ -z "$vmId" ]; then
      echo -e "${RED}Usage: vers-client.sh vm-eval <vmId> [skip...]${NC}"
      echo -e "  skip: build, test, lint, typecheck"
      exit 1
    fi
    escaped_vmId=$(printf '%s' "$vmId" | jq -Rs .)
    shift 2 2>/dev/null
    skip_args=""
    if [ $# -gt 0 ]; then
      skip_json=$(printf '%s\n' "$@" | jq -R . | jq -s .)
      skip_args=",\"skip\":${skip_json}"
    fi
    echo -e "${BLUE}Evaluating VM ${vmId}...${NC}"
    result=$(rpc "vm/eval" "{\"vmId\":${escaped_vmId}${skip_args}}")
    echo "$result" | jq '.result | {
      success: .success,
      projectType: .projectType,
      score: .score,
      scoreBreakdown: .scoreBreakdown,
      results: (.results | to_entries | map({
        key: .key,
        success: .value.success,
        durationMs: .value.durationMs,
        metrics: .value.metrics
      }) | from_entries),
      totalDurationMs: .totalDurationMs
    }'
    ;;

  vm-wait)
    # Wait for a VM to complete its current task
    vmId="${2:-}"
    timeout="${3:-}"
    if [ -z "$vmId" ]; then
      echo -e "${RED}Usage: vers-client.sh vm-wait <vmId> [timeout_ms]${NC}"
      exit 1
    fi
    escaped_vmId=$(printf '%s' "$vmId" | jq -Rs .)
    echo -e "${BLUE}Waiting for VM ${vmId} to complete...${NC}"
    if [ -n "$timeout" ]; then
      rpc "vm/wait" "{\"vmId\":${escaped_vmId},\"timeout\":${timeout}}" | jq .result
    else
      rpc "vm/wait" "{\"vmId\":${escaped_vmId}}" | jq .result
    fi
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
    echo "  skill <name> [args] Invoke a skill"
    echo ""
    echo "  vms                 List VMs"
    echo "  vm-create [task]    Create a new VM"
    echo "  vm-run <prompt>     Run prompt on all VMs"
    echo "  vm-exec <vmId> <cmd>  Execute command on VM via SSH"
    echo "  vm-upload <vmId> <local> <remote>  Upload file/dir to VM"
    echo "  vm-events [afterSeq] [vmIds]  Poll for VM events"
    echo "  vm-watch [vmIds]    Watch multiplexed VM event stream (SSE)"
    echo "  vm-outputs <vmId> [limit]  Get outputs from a VM"
    echo "  vm-status [limit]          Get status + last message from all VMs"
    echo "  vm-sync <vmId> [base]      Sync local git changes to VM via bundle"
    echo "  vm-sync-all [base]         Sync local git changes to ALL VMs"
    echo "  vm-eval <vmId> [skip...]   Evaluate VM (build, test, lint, typecheck)"
    echo "  vm-wait <vmId> [timeout]   Wait for VM to complete task"
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
