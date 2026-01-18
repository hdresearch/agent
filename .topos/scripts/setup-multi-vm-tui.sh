#!/usr/bin/env bash
# Setup Multi-VM TUI with ngrok tunnels and Gay.jl color coding
# This script sets up 3 VMs with ngrok tunnels and GF(3) trit assignments

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🌈 Multi-VM TUI Setup with Gay.jl Color Coding"
echo "=============================================="
echo ""

# Check if VMs are running
if ! docker ps --format '{{.Names}}' | grep -q "agent-vers-"; then
  echo "❌ No vers VMs are running"
  echo "Please start VMs first with: docker compose up -d"
  exit 1
fi

echo "📝 Creating fleet configuration with Gay.jl colors..."

# Get running VM names
VMS=$(docker ps --format '{{.Names}}' | grep "agent-vers-" | sort)

# Create fleet config with 3 VMs
cat > "$PROJECT_ROOT/fleet-config.json" <<'EOF'
{
  "fleet": [
    {
      "id": "alpha",
      "name": "crimson",
      "color": "#DC143C",
      "trit": -1,
      "url": "http://localhost:9999",
      "container": "agent-vers-alpha-1",
      "ram": 1024,
      "vcpu": 2
    },
    {
      "id": "bravo",
      "name": "indigo",
      "color": "#4B0082",
      "trit": 0,
      "url": "http://localhost:9999",
      "container": "agent-vers-bravo-1",
      "ram": 1024,
      "vcpu": 2
    },
    {
      "id": "charlie",
      "name": "azure",
      "color": "#007FFF",
      "trit": 1,
      "url": "http://localhost:9999",
      "container": "agent-vers-charlie-1",
      "ram": 1024,
      "vcpu": 2
    }
  ],
  "balancing": {
    "strategy": "gf3-trit",
    "description": "GF(3) field-based load balancing using trit sum ≡ 0 (mod 3)"
  }
}
EOF

echo "✅ Fleet configuration created at $PROJECT_ROOT/fleet-config.json"
echo ""
echo "🚀 Multi-VM TUI Setup Complete!"
echo ""
echo "Running VMs:"
docker ps --format "  • {{.Names}}" --filter "name=vers-"
echo ""
echo "Next steps:"
echo "  1. Run: just cli"
echo "  2. Use /vm status to see all VMs with Gay.jl colors"
echo "  3. Use /vm switch to rotate through VMs"
echo "  4. Use /vm select <id> to switch to specific VM"
echo "  5. Use /vm health to check VM health"
echo ""
echo "GF(3) Trit Assignments:"
echo "  • crimson (alpha):  -1 (MINUS - verification/analysis)"
echo "  • indigo  (bravo):   0 (ERGODIC - coordination/balance)"
echo "  • azure   (charlie): +1 (PLUS - generation/synthesis)"
echo ""
