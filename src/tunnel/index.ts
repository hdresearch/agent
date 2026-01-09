/**
 * ngrok Tunnel Module for vers-agent
 * 
 * Exposes local vers-agent server via ngrok with:
 * - Custom domain support
 * - IP whitelisting (policy.yml)
 * - Automatic URL registration
 */

import { spawn, type Subprocess } from "bun";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { logStream } from "../utils/log-stream";

const POLICY_PATH = join(dirname(import.meta.path), "policy.yml");

export interface TunnelConfig {
  port: number;
  domain?: string;        // Custom domain (e.g., "mcp.yourdomain.com")
  authtoken?: string;     // ngrok authtoken (or use NGROK_AUTHTOKEN env)
  usePolicy?: boolean;    // Apply IP restrictions from policy.yml
}

export interface TunnelInfo {
  url: string;
  domain: string;
  status: "online" | "offline" | "error";
}

let ngrokProcess: Subprocess | null = null;

/**
 * Start ngrok tunnel for vers-agent server
 */
export async function startTunnel(config: TunnelConfig): Promise<TunnelInfo> {
  const { port, domain, authtoken, usePolicy = true } = config;
  
  // Build ngrok command
  const args = ["http", String(port)];
  
  if (domain) {
    args.push("--url", domain);
  }
  
  if (usePolicy && existsSync(POLICY_PATH)) {
    args.push("--traffic-policy-file", POLICY_PATH);
    logStream.debug(`[tunnel] Using policy: ${POLICY_PATH}`);
  }
  
  if (authtoken) {
    args.push("--authtoken", authtoken);
  }
  
  // Check if ngrok is installed
  const which = Bun.spawnSync(["which", "ngrok"]);
  if (which.exitCode !== 0) {
    throw new Error("ngrok not found. Install with: brew install ngrok");
  }
  
  logStream.debug(`[tunnel] Starting: ngrok ${args.join(" ")}`);
  
  ngrokProcess = spawn(["ngrok", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  
  // Wait for tunnel to establish and get URL
  const tunnelUrl = await getTunnelUrl();
  
  return {
    url: tunnelUrl,
    domain: domain || new URL(tunnelUrl).hostname,
    status: "online",
  };
}

/**
 * Get the public URL from ngrok API
 */
async function getTunnelUrl(retries = 10): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch("http://127.0.0.1:4040/api/tunnels");
      if (res.ok) {
        const data = await res.json() as { tunnels: Array<{ public_url: string }> };
        const tunnel = data.tunnels.find(t => t.public_url.startsWith("https"));
        if (tunnel) {
          return tunnel.public_url;
        }
      }
    } catch {
      // ngrok API not ready yet
    }
    await Bun.sleep(500);
  }
  throw new Error("Failed to get ngrok tunnel URL");
}

/**
 * Stop the ngrok tunnel
 */
export function stopTunnel(): void {
  if (ngrokProcess) {
    ngrokProcess.kill();
    ngrokProcess = null;
    logStream.debug("[tunnel] Stopped");
  }
}

/**
 * Get current tunnel status
 */
export async function getTunnelStatus(): Promise<TunnelInfo | null> {
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels");
    if (res.ok) {
      const data = await res.json() as { tunnels: Array<{ public_url: string }> };
      const tunnel = data.tunnels.find(t => t.public_url.startsWith("https"));
      if (tunnel) {
        return {
          url: tunnel.public_url,
          domain: new URL(tunnel.public_url).hostname,
          status: "online",
        };
      }
    }
  } catch {
    // ngrok not running
  }
  return null;
}

// CLI usage
if (import.meta.main) {
  const port = parseInt(process.argv[2] || "8765");
  const domain = process.argv[3];
  
  console.log(`Starting ngrok tunnel on port ${port}...`);
  
  try {
    const info = await startTunnel({ port, domain });
    console.log(`\n✓ Tunnel active: ${info.url}`);
    console.log(`  Domain: ${info.domain}`);
    console.log(`  Policy: ${existsSync(POLICY_PATH) ? "enabled" : "disabled"}`);
    console.log(`\nPress Ctrl+C to stop\n`);
    
    // Keep alive
    process.on("SIGINT", () => {
      stopTunnel();
      process.exit(0);
    });
  } catch (e) {
    console.error("Failed to start tunnel:", e);
    process.exit(1);
  }
}
