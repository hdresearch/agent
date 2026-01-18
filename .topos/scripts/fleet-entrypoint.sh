#!/usr/bin/env bash
# Fleet entrypoint for remote vers-agent VMs
# Handles ngrok tunnel setup + vers-agent server launch
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  vers-agent fleet node: ${VERS_VM_NAME:-unnamed} (${VERS_VM_ID:-unknown})"
echo "  trit: ${VERS_VM_TRIT:-?} | color: ${VERS_VM_COLOR:-#888888}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

VERS_AGENT_HOME="${VERS_AGENT_HOME:-/tmp/.vers-agent}"
mkdir -p "$VERS_AGENT_HOME/logs" 2>/dev/null || true

# Load external environment if mounted
if [ -f "$HOME/.topos/.env" ]; then
  echo "[init] Loading environment from ~/.topos/.env"
  set -a
  . "$HOME/.topos/.env"
  set +a
fi

# Cleanup function
cleanup() {
  echo "[shutdown] Cleaning up..."
  [ -n "$NGROK_PID" ] && kill "$NGROK_PID" 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# Start ngrok tunnel with auto-reconnect
start_ngrok() {
  if [ -z "$NGROK_AUTHTOKEN" ]; then
    echo "[ngrok] Warning: NGROK_AUTHTOKEN not set, skipping tunnel"
    return
  fi
  
  echo "[ngrok] Starting tunnel on port ${PORT:-9999}..."
  
  while true; do
    NGROK_ARGS="http ${PORT:-9999} --authtoken $NGROK_AUTHTOKEN --log stdout --log-level info"
    
    # Reserved domain
    [ -n "$NGROK_DOMAIN" ] && NGROK_ARGS="$NGROK_ARGS --url $NGROK_DOMAIN"
    
    # Traffic policy
    [ -f "/app/config/policy.yml" ] && NGROK_ARGS="$NGROK_ARGS --traffic-policy-file /app/config/policy.yml"
    
    ngrok $NGROK_ARGS 2>&1 | tee "$VERS_AGENT_HOME/logs/ngrok.log" &
    NGROK_PID=$!
    
    # Wait for tunnel
    sleep 3
    
    # Extract and log tunnel URL
    TUNNEL_URL=$(curl -sf http://127.0.0.1:4040/api/tunnels 2>/dev/null | jq -r '.tunnels[0].public_url // empty' || echo "")
    if [ -n "$TUNNEL_URL" ]; then
      echo "[ngrok] ✓ Tunnel active: $TUNNEL_URL"
      echo "$TUNNEL_URL" > "$VERS_AGENT_HOME/tunnel_url"
      
      # Notify controller if webhook configured
      if [ -n "$FLEET_CONTROLLER_WEBHOOK" ]; then
        curl -sf -X POST "$FLEET_CONTROLLER_WEBHOOK" \
          -H "Content-Type: application/json" \
          -d "{\"vm_id\":\"${VERS_VM_ID}\",\"tunnel_url\":\"${TUNNEL_URL}\",\"trit\":${VERS_VM_TRIT:-0}}" \
          2>/dev/null || true
      fi
    fi
    
    # Wait for ngrok exit
    wait $NGROK_PID || true
    echo "[ngrok] Tunnel disconnected, reconnecting in 5s..."
    sleep 5
  done
}

# Start ngrok in background
start_ngrok &

# Start vers-agent ACP server
echo "[vers] Starting ACP server on port ${PORT:-9999}..."
cd /app
exec bun run dist/index.js --server
