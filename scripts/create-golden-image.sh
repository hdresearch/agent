#!/bin/bash
# Create a new golden image with the latest vers-agent code
# This script creates a VM, installs vers-agent, and commits it as a golden image
#
# Usage:
#   ./scripts/create-golden-image.sh
#
# Environment variables required:
#   - VERS_API_KEY: Vers API key
#   - ANTHROPIC_API_KEY: Anthropic API key (will be baked into image)
#   - VERS_ORCHESTRATOR_SECRET: Secret for token derivation
#
# After running, set the new golden commit ID:
#   export VERS_GOLDEN_COMMIT_ID=<output commit id>

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check required environment variables
if [ -z "$VERS_API_KEY" ]; then
  echo -e "${RED}Error: VERS_API_KEY not set${NC}"
  exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo -e "${RED}Error: ANTHROPIC_API_KEY not set${NC}"
  exit 1
fi

if [ -z "$VERS_ORCHESTRATOR_SECRET" ]; then
  echo -e "${YELLOW}Warning: VERS_ORCHESTRATOR_SECRET not set, using default${NC}"
  VERS_ORCHESTRATOR_SECRET=$(openssl rand -base64 32)
  echo -e "${BLUE}Generated secret: ${VERS_ORCHESTRATOR_SECRET}${NC}"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}Creating golden image for vers-agent${NC}"
echo ""

# Create a temporary TypeScript file for the operation
TEMP_SCRIPT=$(mktemp /tmp/create-golden-XXXXX.ts)

cat > "$TEMP_SCRIPT" << 'ENDSCRIPT'
import Vers, { withSSH } from "vers/dist/index.mjs";
import { createHash } from "crypto";

const VERS_API_KEY = process.env.VERS_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const ORCHESTRATOR_SECRET = process.env.VERS_ORCHESTRATOR_SECRET!;
const PROJECT_DIR = process.env.PROJECT_DIR!;

const client = new Vers({
  apiKey: VERS_API_KEY,
  baseURL: "https://api.vers.sh/api/v1"
});
const vm = withSSH(client.vm);

function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function exec(vmId: string, cmd: string, desc: string): Promise<string> {
  log(`  ${desc}...`);
  const result = await vm.execute(vmId, cmd);
  if (result.stderr && result.exitCode !== 0) {
    console.error(`  Error: ${result.stderr.slice(0, 200)}`);
  }
  return result.stdout || "";
}

async function main() {
  log("Creating root VM...");
  const response = await client.vm.createRoot({ vm_config: {}, wait: true });
  const vmId = response.vm_id;
  log(`VM created: ${vmId}`);

  // Wait for VM to be ready
  await new Promise(r => setTimeout(r, 5000));

  log("\n1. Installing system packages...");
  await exec(vmId, "apt-get update -qq", "apt update");
  await exec(vmId, "apt-get install -y -qq git curl unzip jq xz-utils", "apt install");

  log("\n2. Installing Bun...");
  await exec(vmId, "curl -fsSL https://bun.sh/install | bash", "install bun");
  const bunVer = await exec(vmId, "/root/.bun/bin/bun --version", "verify bun");
  log(`  Bun version: ${bunVer.trim()}`);

  log("\n3. Installing Node.js (for Claude Code)...");
  await exec(vmId, "cd /tmp && curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz -o node.tar.xz", "download node");
  await exec(vmId, "cd /tmp && tar -xf node.tar.xz && cp -r node-v20.18.0-linux-x64/* /usr/local/", "install node");
  const nodeVer = await exec(vmId, "/usr/local/bin/node --version", "verify node");
  log(`  Node version: ${nodeVer.trim()}`);

  log("\n4. Installing Claude Code...");
  await exec(vmId, "/usr/local/bin/npm install -g @anthropic-ai/claude-code", "npm install claude");
  const claudeVer = await exec(vmId, "claude --version 2>&1 || echo 'installed'", "verify claude");
  log(`  Claude: ${claudeVer.trim()}`);

  log("\n5. Cloning vers-agent...");
  await exec(vmId, "cd /root && rm -rf vers-agent", "clean old");
  await exec(vmId, "cd /root && git clone --depth 1 https://github.com/hdresearch/agent.git vers-agent", "clone");

  log("\n6. Installing dependencies...");
  await exec(vmId, "cd /root/vers-agent && /root/.bun/bin/bun install", "bun install");

  log("\n7. Building vers-agent...");
  await exec(vmId, "cd /root/vers-agent && /root/.bun/bin/bun run build", "bun build");

  log("\n8. Configuring environment...");
  await exec(vmId, "mkdir -p /etc/vers-agent", "mkdir config");

  const envContent = `ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
VERS_ORCHESTRATOR_SECRET=${ORCHESTRATOR_SECRET}`;

  const envBase64 = Buffer.from(envContent).toString("base64");
  await exec(vmId, `echo '${envBase64}' | base64 -d > /etc/vers-agent/env`, "write env");

  log("\n9. Setting up systemd service...");
  const serviceContent = `[Unit]
Description=Vers Agent
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/vers-agent/env
ExecStart=/root/vers-agent/vers-agent --server
WorkingDirectory=/root/vers-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`;

  const serviceBase64 = Buffer.from(serviceContent).toString("base64");
  await exec(vmId, `echo '${serviceBase64}' | base64 -d > /etc/systemd/system/vers-agent.service`, "write service");
  await exec(vmId, "systemctl daemon-reload && systemctl enable vers-agent", "enable service");

  log("\n10. Testing vers-agent...");
  await exec(vmId, "systemctl start vers-agent", "start service");
  await new Promise(r => setTimeout(r, 5000));

  const health = await exec(vmId, "curl -s http://localhost:80/health", "health check");
  log(`  Health: ${health.slice(0, 100)}`);

  if (!health.includes("ok")) {
    log("\nWarning: Health check failed, checking logs...");
    const logs = await exec(vmId, "journalctl -u vers-agent --no-pager -n 20", "check logs");
    console.log(logs);
  }

  log("\n11. Creating golden commit...");
  // Stop vers-agent before commit to avoid state issues
  await exec(vmId, "systemctl stop vers-agent", "stop service");

  const commit = await client.vm.commit(vmId, { name: "vers-agent-golden" });
  const commitId = commit.commit_id;

  log(`\n${"=".repeat(60)}`);
  log(`Golden image created successfully!`);
  log(`${"=".repeat(60)}`);
  log(``);
  log(`VM ID: ${vmId}`);
  log(`Commit ID: ${commitId}`);
  log(``);
  log(`To use this golden image, set:`);
  log(`  export VERS_GOLDEN_COMMIT_ID=${commitId}`);
  log(`  export VERS_ORCHESTRATOR_SECRET=${ORCHESTRATOR_SECRET}`);
  log(``);

  // Clean up VM (optional - comment out to keep for testing)
  log("Cleaning up VM...");
  await client.vm.delete(vmId);
  log("VM deleted.");
}

main().catch(e => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
ENDSCRIPT

# Run the script
echo -e "${BLUE}Running golden image creation script...${NC}"
PROJECT_DIR="$PROJECT_DIR" bun run "$TEMP_SCRIPT"

# Clean up
rm -f "$TEMP_SCRIPT"

echo -e "\n${GREEN}Done!${NC}"
