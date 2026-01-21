/**
 * Bootstrap vers-agent on a VM
 *
 * Downloads the nightly binary from GitHub releases.
 * See: https://github.com/hdresearch/agent/releases/tag/nightly
 */

import { execute, getAgentUrl } from "./index";
import { VM_AGENT_DIR, VM_HOME_DIR } from "./constants";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getConfig } from "../utils/config";

const NIGHTLY_RELEASE_URL = "https://github.com/hdresearch/agent/releases/download/nightly/vers-agent-linux-x64";
const REMOTE_BINARY_PATH = "/usr/local/bin/vers-agent";
const SYSTEMD_SERVICE_PATH = resolve(import.meta.dir, "vers-agent.service");
// Agent listens on port 80 inside VM, vers proxy routes external :443 → VM :80
const AGENT_PORT = 80;

/**
 * Bootstrap vers-agent on a VM.
 * Downloads nightly binary from GitHub if needed, starts server, waits for it to be healthy.
 *
 * @returns The agent URL (https://{vmId}.vm.vers.sh)
 */
export async function bootstrap(vmId: string): Promise<string> {
  // Check if vers-agent is already running
  const alreadyRunning = await isAgentRunning(vmId);
  if (alreadyRunning) {
    return getAgentUrl(vmId);
  }

  // Ensure Node.js is installed (needed for agent harness auto-install)
  // TODO: Remove once Node.js is pre-installed in VM image (see issue #16)
  await ensureNodeInstalled(vmId);

  // Create working directory for vers-agent (systemd WorkingDirectory)
  await execute(vmId, `mkdir -p ${VM_AGENT_DIR}`);

  // Check if binary exists on VM
  const binaryExists = await checkBinaryExists(vmId);

  if (!binaryExists) {
    // Download the nightly binary from GitHub releases
    console.log(`[${vmId}] Downloading vers-agent nightly binary...`);
    await execute(vmId, `curl -fsSL -o ${REMOTE_BINARY_PATH} "${NIGHTLY_RELEASE_URL}"`);
    await execute(vmId, `chmod +x ${REMOTE_BINARY_PATH}`);

    // Verify download succeeded
    const verifyResult = await execute(vmId, `test -s ${REMOTE_BINARY_PATH} && echo "ok"`);
    if (!verifyResult.stdout.includes("ok")) {
      throw new Error(`[${vmId}] Failed to download vers-agent binary`);
    }
  }

  // Start vers-agent via systemd (preferred) or fallback to nohup
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required to bootstrap vers-agent");
  }

  // Check if systemd is available
  const hasSystemd = await checkSystemdAvailable(vmId);

  if (hasSystemd) {
    console.log(`[${vmId}] Installing systemd service...`);
    await installSystemdService(vmId, apiKey);
  } else {
    // Fallback to nohup for systems without systemd
    console.log(`[${vmId}] Starting vers-agent server on port ${AGENT_PORT} (nohup)...`);
    const config = getConfig();
    const gatewayEnv = config.llmGatewayUrl ? `ANTHROPIC_BASE_URL=${config.llmGatewayUrl} ` : "";
    await execute(vmId, `${gatewayEnv}ANTHROPIC_API_KEY=${apiKey} PORT=${AGENT_PORT} nohup ${REMOTE_BINARY_PATH} --server > /var/log/vers-agent.log 2>&1 &`);
  }

  // Wait for it to be healthy (checks via SSH)
  await waitForHealthy(vmId);

  return getAgentUrl(vmId);
}

/**
 * Ensure Node.js is installed on the VM
 * TODO: Remove once Node.js is pre-installed in VM image (see issue #16)
 */
async function ensureNodeInstalled(vmId: string): Promise<void> {
  // Check if node already exists
  try {
    const result = await execute(vmId, "which node");
    if (result.stdout.trim()) {
      console.log(`[${vmId}] Node.js already installed`);
      return;
    }
  } catch {
    // Node not found, need to install
  }

  console.log(`[${vmId}] Installing Node.js + git + Claude Code (this may take 30-60s)...`);

  // Install Node.js via NodeSource and git
  await execute(vmId, "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -");
  await execute(vmId, "apt-get install -y nodejs git");

  // Install Claude Code CLI
  await execute(vmId, "npm install -g @anthropic-ai/claude-code");

  // Verify installation
  const verifyResult = await execute(vmId, "node --version && claude --version");
  console.log(`[${vmId}] Installed: node ${verifyResult.stdout.trim().replace(/\n/g, ", claude ")}`);
}

/**
 * Check if vers-agent binary exists on the VM
 */
async function checkBinaryExists(vmId: string): Promise<boolean> {
  try {
    const result = await execute(vmId, `test -f ${REMOTE_BINARY_PATH} && echo "exists"`);
    return result.stdout.trim() === "exists";
  } catch {
    return false;
  }
}

/**
 * Check if vers-agent is already running and healthy via SSH
 */
async function isAgentRunning(vmId: string): Promise<boolean> {
  try {
    const result = await execute(vmId, `curl -s http://localhost:${AGENT_PORT}/health`);
    return result.stdout.includes('"status"');
  } catch {
    return false;
  }
}

/**
 * Wait for the agent to become healthy (via SSH tunnel)
 */
async function waitForHealthy(vmId: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await execute(vmId, `curl -s http://localhost:${AGENT_PORT}/health`);
      if (result.stdout.includes('"status"')) {
        console.log(`[${vmId}] Agent is healthy`);
        return;
      }
      if (i === 0) {
        console.log(`[${vmId}] Waiting for agent...`);
      }
    } catch {
      // Not ready yet
    }

    // Wait 1 second before retrying
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`[${vmId}] Agent failed to become healthy after ${maxAttempts} attempts`);
}

/**
 * Stop vers-agent on a VM
 */
export async function stopAgent(vmId: string): Promise<void> {
  try {
    // Try systemd first, then pkill as fallback
    await execute(vmId, "systemctl stop vers-agent 2>/dev/null || pkill -f vers-agent || true");
  } catch {
    // Ignore errors - process might not exist
  }
}

/**
 * Check if systemd is available on the VM
 */
async function checkSystemdAvailable(vmId: string): Promise<boolean> {
  try {
    const result = await execute(vmId, "which systemctl && systemctl --version > /dev/null 2>&1 && echo 'ok'");
    return result.stdout.includes("ok");
  } catch {
    return false;
  }
}

/**
 * Install and start vers-agent as a systemd service
 */
async function installSystemdService(vmId: string, apiKey: string): Promise<void> {
  // Read the service file template
  let serviceContent: string;
  try {
    serviceContent = readFileSync(SYSTEMD_SERVICE_PATH, "utf-8");
  } catch {
    // If service file doesn't exist, use inline template
    serviceContent = `[Unit]
Description=Vers Agent Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${VM_AGENT_DIR}
ExecStart=${REMOTE_BINARY_PATH} --server
Restart=always
RestartSec=5
EnvironmentFile=-/etc/vers-agent/env
Environment=PORT=${AGENT_PORT}
Environment=HOME=${VM_HOME_DIR}
Environment=PATH=/usr/local/bin:/usr/bin:/bin

StandardOutput=journal
StandardError=journal
SyslogIdentifier=vers-agent

[Install]
WantedBy=multi-user.target
`;
  }

  // Update the service file to use the binary path and correct port
  serviceContent = serviceContent
    .replace(/ExecStart=.*/, `ExecStart=${REMOTE_BINARY_PATH} --server`)
    .replace(/Environment=PORT=.*/, `Environment=PORT=${AGENT_PORT}`);

  // Add API key to environment
  serviceContent = serviceContent.replace(
    /\[Service\]/,
    `[Service]\nEnvironment=ANTHROPIC_API_KEY=${apiKey}`
  );

  // Add LLM gateway URL if configured
  const config = getConfig();
  if (config.llmGatewayUrl) {
    serviceContent = serviceContent.replace(
      /\[Service\]/,
      `[Service]\nEnvironment=ANTHROPIC_BASE_URL=${config.llmGatewayUrl}`
    );
    console.log(`[${vmId}] Using LLM gateway: ${config.llmGatewayUrl}`);
  }

  // Write service file to VM
  const escapedContent = serviceContent.replace(/'/g, "'\\''");
  await execute(vmId, `cat > /etc/systemd/system/vers-agent.service << 'EOFSERVICE'
${serviceContent}
EOFSERVICE`);

  // Reload systemd, enable and start the service
  await execute(vmId, "systemctl daemon-reload");
  await execute(vmId, "systemctl enable vers-agent");
  await execute(vmId, "systemctl start vers-agent");

  console.log(`[${vmId}] Systemd service installed and started`);
}
