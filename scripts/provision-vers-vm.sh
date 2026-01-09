#!/usr/bin/env bash
# provision-vers-vm.sh - Provision a vers-agent VM with ngrok tunnel
# Uses ~/.topos/.env for NGROK_AUTHTOKEN and ANTHROPIC_API_KEY
#
# Usage:
#   ./scripts/provision-vers-vm.sh [vm-name] [domain]
#
# Examples:
#   ./scripts/provision-vers-vm.sh vers-production
#   ./scripts/provision-vers-vm.sh vers-test vers-test.ngrok.io

set -euo pipefail

# Colors
R='\033[31m' G='\033[32m' Y='\033[33m' B='\033[34m' M='\033[35m' C='\033[36m'
BOLD='\033[1m' RESET='\033[0m'

VM_NAME="${1:-vers-acp-$(date +%s)}"
NGROK_DOMAIN="${2:-}" # Optional custom domain

# Source ~/.topos/.env for credentials
TOPOS_ENV="${HOME}/.topos/.env"
if [[ ! -f "$TOPOS_ENV" ]]; then
  echo -e "${R}Error: $TOPOS_ENV not found${RESET}"
  echo "This file should contain NGROK_AUTHTOKEN and ANTHROPIC_API_KEY"
  exit 1
fi

# Load environment variables
set -a
# shellcheck disable=SC1090
source "$TOPOS_ENV"
set +a

# Validate required variables
if [[ -z "${NGROK_AUTHTOKEN:-}" ]]; then
  echo -e "${R}Error: NGROK_AUTHTOKEN not set in $TOPOS_ENV${RESET}"
  exit 1
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo -e "${Y}Warning: ANTHROPIC_API_KEY not set in $TOPOS_ENV${RESET}"
  echo "The agent will not be able to call Claude API"
fi

# Check if Docker is available
if ! command -v docker &> /dev/null; then
  echo -e "${R}Error: Docker not found. Install Docker first.${RESET}"
  exit 1
fi

echo -e "${M}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${M}${BOLD}vers-agent VM Provisioning | #c778ea${RESET}"
echo -e "${M}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "VM Name:     ${C}$VM_NAME${RESET}"
echo -e "Domain:      ${C}${NGROK_DOMAIN:-auto-generated}${RESET}"
echo -e "Env:         ${C}$TOPOS_ENV${RESET}"
echo ""

# Step 1: Build lean image
echo -e "${B}[1/5]${RESET} Building lean Docker image..."
docker build -f Dockerfile.lean -t vers-agent:lean .

# Step 2: Create data volume
echo -e "${B}[2/5]${RESET} Creating data volume..."
VOLUME_NAME="vers-agent-data-${VM_NAME}"
docker volume create "$VOLUME_NAME"

# Step 3: Run container
echo -e "${B}[3/5]${RESET} Starting container..."
DOCKER_RUN_ARGS=(
  -d
  --name "$VM_NAME"
  --restart unless-stopped
  -v "${VOLUME_NAME}:/home/vers/.vers-agent"
  -v "${HOME}/.topos:/home/vers/.topos:ro"
  -e "NGROK_AUTHTOKEN=${NGROK_AUTHTOKEN}"
  -e "PORT=9999"
  -e "NODE_ENV=production"
  -p 9999:9999
)

# Add API key if available
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  DOCKER_RUN_ARGS+=(-e "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}")
fi

# Add custom domain if specified
if [[ -n "$NGROK_DOMAIN" ]]; then
  DOCKER_RUN_ARGS+=(-e "NGROK_DOMAIN=${NGROK_DOMAIN}")
fi

docker run "${DOCKER_RUN_ARGS[@]}" vers-agent:lean

# Step 4: Wait for health
echo -e "${B}[4/5]${RESET} Waiting for server to be healthy..."
for i in {1..30}; do
  if docker exec "$VM_NAME" curl -sf http://localhost:9999/health > /dev/null 2>&1; then
    echo -e "${G}✓ Server healthy${RESET}"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo -e "${R}✗ Server failed to become healthy${RESET}"
    echo ""
    echo "Container logs:"
    docker logs "$VM_NAME"
    exit 1
  fi
done

# Step 5: Get ngrok URL
echo -e "${B}[5/5]${RESET} Retrieving ngrok tunnel URL..."
sleep 3

NGROK_URL=""
for i in {1..10}; do
  NGROK_URL=$(docker exec "$VM_NAME" sh -c "curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o 'https://[^\"]*ngrok[^\"]*' | head -1" || echo "")
  if [[ -n "$NGROK_URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$NGROK_URL" ]]; then
  echo -e "${Y}Warning: Could not retrieve ngrok URL (tunnel may still be establishing)${RESET}"
  echo "Check manually: docker logs $VM_NAME"
else
  echo -e "${G}✓ ngrok tunnel active${RESET}"
fi

# Success summary
echo ""
echo -e "${M}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${G}${BOLD}✓ vers-agent VM deployed successfully${RESET}"
echo -e "${M}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "VM Name:       ${C}$VM_NAME${RESET}"
echo -e "Container ID:  ${C}$(docker ps -qf "name=$VM_NAME")${RESET}"
echo -e "Volume:        ${C}$VOLUME_NAME${RESET}"
if [[ -n "$NGROK_URL" ]]; then
  echo -e "Public URL:    ${G}${BOLD}$NGROK_URL${RESET}"
fi
echo -e "Local Port:    ${C}http://localhost:9999${RESET}"
echo -e "${M}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "${BOLD}Test connection:${RESET}"
if [[ -n "$NGROK_URL" ]]; then
  echo -e "  ${C}vers-agent --remote $NGROK_URL${RESET}"
else
  echo -e "  ${C}vers-agent --remote http://localhost:9999${RESET}"
fi
echo ""
echo -e "${BOLD}Add to Claude Desktop:${RESET}"
echo -e "  Settings → Integrations → Add Remote MCP Server"
if [[ -n "$NGROK_URL" ]]; then
  echo -e "  URL: ${C}$NGROK_URL${RESET}"
fi
echo ""
echo -e "${BOLD}View logs:${RESET}"
echo -e "  ${C}docker logs -f $VM_NAME${RESET}"
echo ""
echo -e "${BOLD}Stop VM:${RESET}"
echo -e "  ${C}docker stop $VM_NAME${RESET}"
echo ""
echo -e "${BOLD}Remove VM:${RESET}"
echo -e "  ${C}docker rm -f $VM_NAME && docker volume rm $VOLUME_NAME${RESET}"
echo ""
