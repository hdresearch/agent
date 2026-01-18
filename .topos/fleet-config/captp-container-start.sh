#!/bin/bash
# captp-container-start.sh
# Starts the CapTP listener container using Apple Containerization framework
#
# This script is designed to be called by launchd for boot persistence.
# It uses cctl (from Apple's Containerization framework) to run a lightweight
# Linux VM with the OCapN/CapTP server.
#
# Usage:
#   ./captp-container-start.sh           # Start with defaults
#   ./captp-container-start.sh --direct  # Run Bun directly (no container)

set -euo pipefail

# Configuration
CONTAINER_ID="captp-9323"
IMAGE="docker.io/oven/bun:alpine"
CAPTP_PORT=9323
MEMORY_MB=512
CPUS=2

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="${SCRIPT_DIR}"
LOG_FILE="${LOG_FILE:-/tmp/captp-container.log}"

# Tailscale IP (update this to match your machine)
TAILSCALE_IP="${TAILSCALE_IP:-100.69.33.107}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Check for --direct flag (run without container)
if [[ "${1:-}" == "--direct" ]]; then
    log "Starting CapTP server directly with Bun..."
    cd "$SERVER_DIR"
    # Use full path to bun (installed via Amp)
    exec /Users/bob/.amp/bin/bun run ocapn-server.ts
fi

log "Starting CapTP container..."
log "  Container ID: $CONTAINER_ID"
log "  Image: $IMAGE"
log "  Port: $CAPTP_PORT"
log "  Server Dir: $SERVER_DIR"

# Check if cctl is available
if ! command -v cctl &> /dev/null; then
    log "ERROR: cctl not found. Apple Containerization framework not installed."
    log "Falling back to direct Bun execution..."
    cd "$SERVER_DIR"
    exec /Users/bob/.amp/bin/bun run ocapn-server.ts
fi

# Check if container is already running
if cctl list 2>/dev/null | grep -q "$CONTAINER_ID"; then
    log "Container $CONTAINER_ID already running"
    # Attach to existing container's logs
    exec cctl logs "$CONTAINER_ID" -f
fi

# Start the container
log "Launching container with cctl..."

exec cctl run \
    --id "$CONTAINER_ID" \
    --image "$IMAGE" \
    --cpus "$CPUS" \
    --memory "$MEMORY_MB" \
    --mount "$SERVER_DIR:/app:ro" \
    --ip "10.0.0.2" \
    --gateway "10.0.0.1" \
    --ns "8.8.8.8" \
    -- /bin/sh -c "cd /app && bun run ocapn-server.ts" \
    2>&1 | tee -a "$LOG_FILE"
