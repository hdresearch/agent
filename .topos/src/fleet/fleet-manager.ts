// Fleet manager - tracks VM status and lifecycle
import { parse as parseYaml } from "yaml";
import { existsSync } from "fs";
import { logStream } from "../utils/log-stream";
import type { VmInfo, VmStatus, FleetConfig, FleetStatus, FleetEvent } from "./types";

type FleetEventHandler = (event: FleetEvent) => void;

class FleetManager {
  private config: FleetConfig | null = null;
  private vms: Map<string, VmInfo> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: Set<FleetEventHandler> = new Set();
  private lastUpdate = 0;

  /**
   * Load fleet configuration from YAML file
   */
  async loadConfig(configPath: string): Promise<FleetConfig | null> {
    try {
      if (!existsSync(configPath)) {
        logStream.debug(`Fleet config not found: ${configPath}`);
        return null;
      }

      const content = await Bun.file(configPath).text();
      const yaml = parseYaml(content) as { fleet?: FleetConfig; vms?: VmInfo[] };
      
      if (!yaml.fleet && !yaml.vms) {
        logStream.debug("Invalid fleet config: missing fleet or vms");
        return null;
      }

      this.config = {
        name: yaml.fleet?.name || "default",
        version: yaml.fleet?.version || "1.0",
        vms: yaml.vms || [],
      };

      // Initialize VM map
      this.vms.clear();
      for (const vm of this.config.vms) {
        this.vms.set(vm.id, {
          ...vm,
          status: "offline",
          health: undefined,
        });
      }

      this.lastUpdate = Date.now();
      this.emit({ type: "fleet_updated", data: this.config, timestamp: Date.now() });

      return this.config;
    } catch (error) {
      logStream.debug(`Failed to load fleet config: ${error}`);
      return null;
    }
  }

  /**
   * Discover fleet from Docker Compose or running containers
   */
  async discoverFleet(): Promise<VmInfo[]> {
    const discovered: VmInfo[] = [];

    try {
      // Check for running vers-* containers
      const proc = Bun.spawn(["docker", "ps", "--filter", "name=vers-", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      const lines = output.trim().split("\n").filter(l => l);

      for (const line of lines) {
        const [name, status, ports] = line.split("\t");
        if (!name) continue;

        // Parse port from docker ports string (e.g., "0.0.0.0:9001->9999/tcp")
        const portMatch = ports?.match(/:(\d+)->/);
        const port = portMatch?.[1] ? parseInt(portMatch[1], 10) : 9999;

        // Determine VM ID from container name (e.g., "vers-alpha" -> "alpha")
        const id = name.replace(/^vers-/, "");

        const isHealthy = status?.toLowerCase().includes("healthy") || status?.toLowerCase().includes("up");

        discovered.push({
          id,
          domain: `localhost`,
          port,
          status: isHealthy ? "online" : "starting",
        });
      }

      // Update internal state
      for (const vm of discovered) {
        const existing = this.vms.get(vm.id);
        if (existing) {
          existing.status = vm.status;
          existing.port = vm.port;
        } else {
          this.vms.set(vm.id, vm);
        }
      }

      this.lastUpdate = Date.now();
    } catch (error) {
      logStream.debug(`Docker discovery failed: ${error}`);
    }

    return discovered;
  }

  /**
   * Check health of all VMs
   */
  async checkAllHealth(): Promise<Map<string, VmInfo>> {
    const checks = Array.from(this.vms.values()).map(vm => this.checkVmHealth(vm.id));
    await Promise.allSettled(checks);
    return this.vms;
  }

  /**
   * Check health of a single VM
   */
  async checkVmHealth(vmId: string): Promise<VmInfo | null> {
    const vm = this.vms.get(vmId);
    if (!vm) return null;

    const url = this.getVmUrl(vm);
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${url}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseTime = Date.now() - start;
      const data = await response.json() as { status?: string };

      const newStatus: VmStatus = response.ok && data.status === "ok" ? "online" : "error";
      const statusChanged = vm.status !== newStatus;

      vm.status = newStatus;
      vm.health = {
        lastCheck: Date.now(),
        responseTime,
        error: undefined,
      };

      if (statusChanged) {
        this.emit({
          type: "vm_status_changed",
          vmId,
          data: { previous: vm.status, current: newStatus },
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const statusChanged = vm.status !== "offline";

      vm.status = "offline";
      vm.health = {
        lastCheck: Date.now(),
        error: errorMsg,
      };

      if (statusChanged) {
        this.emit({
          type: "vm_status_changed",
          vmId,
          data: { previous: vm.status, current: "offline", error: errorMsg },
          timestamp: Date.now(),
        });
      }
    }

    return vm;
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs = 30000): void {
    this.stopHealthChecks();
    this.healthCheckInterval = setInterval(() => {
      this.checkAllHealth().catch(() => {});
    }, intervalMs);
    // Run immediately
    this.checkAllHealth().catch(() => {});
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get URL for a VM
   */
  getVmUrl(vm: VmInfo): string {
    if (vm.domain.includes("ngrok")) {
      return `https://${vm.domain}`;
    }
    return `http://${vm.domain}:${vm.port}`;
  }

  /**
   * Get all VMs
   */
  getVms(): VmInfo[] {
    return Array.from(this.vms.values());
  }

  /**
   * Get a specific VM
   */
  getVm(vmId: string): VmInfo | undefined {
    return this.vms.get(vmId);
  }

  /**
   * Get fleet status summary
   */
  getStatus(): FleetStatus {
    return {
      config: this.config,
      vms: this.vms,
      lastUpdate: this.lastUpdate,
    };
  }

  /**
   * Get counts by status
   */
  getCounts(): { total: number; online: number; offline: number; error: number } {
    let online = 0, offline = 0, error = 0;
    for (const vm of this.vms.values()) {
      if (vm.status === "online") online++;
      else if (vm.status === "offline") offline++;
      else error++;
    }
    return { total: this.vms.size, online, offline, error };
  }

  /**
   * Subscribe to fleet events
   */
  onEvent(handler: FleetEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: FleetEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        logStream.debug(`Fleet event handler error: ${e}`);
      }
    }
  }

  /**
   * Register a VM manually (for dynamic discovery)
   */
  registerVm(vm: VmInfo): void {
    this.vms.set(vm.id, vm);
    this.lastUpdate = Date.now();
    this.emit({ type: "fleet_updated", data: { added: vm }, timestamp: Date.now() });
  }

  /**
   * Unregister a VM
   */
  unregisterVm(vmId: string): boolean {
    const existed = this.vms.delete(vmId);
    if (existed) {
      this.lastUpdate = Date.now();
      this.emit({ type: "fleet_updated", data: { removed: vmId }, timestamp: Date.now() });
    }
    return existed;
  }

  /**
   * Clear all VMs
   */
  clear(): void {
    this.vms.clear();
    this.config = null;
    this.lastUpdate = Date.now();
    this.stopHealthChecks();
  }
}

// Singleton instance
export const fleetManager = new FleetManager();
