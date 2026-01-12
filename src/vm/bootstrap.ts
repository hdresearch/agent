/**
 * Bootstrap vers-agent on a VM
 *
 * TODO: Once vers-agent is pre-installed in VM image, simplify this.
 * See: https://github.com/hdresearch/agent/issues/16
 */

import { execute, upload, getAgentUrl } from "./index";
import { resolve } from "path";

const LINUX_BINARY_PATH = resolve(import.meta.dir, "../../dist/vers-agent-linux");
const REMOTE_BINARY_PATH = "/usr/local/bin/vers-agent";
// Agent listens on port 80 inside VM, vers proxy routes external :443 → VM :80
const AGENT_PORT = 80;

/**
 * Bootstrap vers-agent on a VM.
 * Uploads binary if needed, starts server, waits for it to be healthy.
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

  // Check if binary exists on VM
  const binaryExists = await checkBinaryExists(vmId);

  if (!binaryExists) {
    // Upload the binary
    console.log(`[${vmId}] Uploading vers-agent binary...`);
    await upload(vmId, LINUX_BINARY_PATH, REMOTE_BINARY_PATH);
    await execute(vmId, `chmod +x ${REMOTE_BINARY_PATH}`);
  }

  // Start vers-agent in server mode (background)
  // Requires ANTHROPIC_API_KEY for the agent to function
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required to bootstrap vers-agent");
  }
  console.log(`[${vmId}] Starting vers-agent server on port ${AGENT_PORT}...`);
  await execute(vmId, `ANTHROPIC_API_KEY=${apiKey} PORT=${AGENT_PORT} nohup ${REMOTE_BINARY_PATH} --server > /var/log/vers-agent.log 2>&1 &`);

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

  console.log(`[${vmId}] Installing Node.js + Claude Code (this may take 30-60s)...`);

  // Install Node.js via NodeSource
  await execute(vmId, "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -");
  await execute(vmId, "apt-get install -y nodejs");

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
    await execute(vmId, "pkill -f vers-agent || true");
  } catch {
    // Ignore errors - process might not exist
  }
}
