/**
 * Multi-VM Fleet Manager with ACP integration and Gay.jl color coding
 * Manages interactions across multiple VMs with GF(3) trit-based balancing
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface VmConfig {
  id: string;
  name: string;
  color: string;
  trit: -1 | 0 | 1;
  url: string;
  container: string;
  ram: number;
  vcpu: number;
  status?: "online" | "offline" | "error";
  lastCheck?: number;
  responseTime?: number;
}

export interface FleetConfig {
  fleet: VmConfig[];
  balancing: {
    strategy: string;
    description: string;
  };
}

export interface VmSession {
  vmId: string;
  sessionId?: string;
  lastUsed: number;
  messageCount: number;
}

/**
 * Multi-VM Fleet Manager with GF(3) trit balancing
 */
export class MultiVmManager {
  private config: FleetConfig | null = null;
  private sessions = new Map<string, VmSession>();
  private currentVmIndex = 0;

  constructor(private configPath?: string) {
    this.loadConfig();
  }

  /**
   * Load fleet configuration from JSON file
   */
  loadConfig(): boolean {
    const path = this.configPath || join(process.cwd(), "fleet-config.json");
    
    if (!existsSync(path)) {
      console.error(`Fleet config not found: ${path}`);
      return false;
    }

    try {
      const data = readFileSync(path, "utf-8");
      this.config = JSON.parse(data);
      return true;
    } catch (error) {
      console.error("Failed to load fleet config:", error);
      return false;
    }
  }

  /**
   * Get all VMs in the fleet
   */
  getVms(): VmConfig[] {
    return this.config?.fleet || [];
  }

  /**
   * Get VM by ID
   */
  getVm(id: string): VmConfig | undefined {
    return this.getVms().find(vm => vm.id === id);
  }

  /**
   * Get current active VM
   */
  getCurrentVm(): VmConfig | undefined {
    const vms = this.getVms();
    return vms[this.currentVmIndex % vms.length];
  }

  /**
   * Switch to next VM (round-robin)
   */
  switchToNextVm(): VmConfig | undefined {
    const vms = this.getVms();
    if (vms.length === 0) return undefined;
    
    this.currentVmIndex = (this.currentVmIndex + 1) % vms.length;
    return this.getCurrentVm();
  }

  /**
   * Switch to specific VM by ID
   */
  switchToVm(id: string): VmConfig | undefined {
    const vms = this.getVms();
    const index = vms.findIndex(vm => vm.id === id);
    
    if (index === -1) return undefined;
    
    this.currentVmIndex = index;
    return this.getCurrentVm();
  }

  /**
   * GF(3) trit-based load balancing
   * Select VM based on trit sum to balance the field
   */
  selectVmByTritBalance(userHash: number): VmConfig | undefined {
    const vms = this.getVms();
    if (vms.length === 0) return undefined;

    // Calculate required trit to balance the user hash
    const userTrit = ((userHash % 3) - 1) as -1 | 0 | 1; // Map 0,1,2 -> -1,0,1
    const requiredTrit = ((-userTrit + 3) % 3 - 1) as -1 | 0 | 1;

    // Find VM with matching trit
    const matchingVm = vms.find(vm => vm.trit === requiredTrit);
    
    return matchingVm || this.getCurrentVm();
  }

  /**
   * Check health of all VMs
   */
  async checkHealth(): Promise<Map<string, VmConfig>> {
    const vms = this.getVms();
    const results = new Map<string, VmConfig>();

    await Promise.all(
      vms.map(async (vm) => {
        const start = Date.now();
        
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          
          const response = await fetch(`${vm.url}/health`, {
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          const updated: VmConfig = {
            ...vm,
            status: response.ok ? "online" : "error",
            lastCheck: Date.now(),
            responseTime: Date.now() - start,
          };
          
          results.set(vm.id, updated);
        } catch (error) {
          results.set(vm.id, {
            ...vm,
            status: "offline",
            lastCheck: Date.now(),
            responseTime: 0,
          });
        }
      })
    );

    return results;
  }

  /**
   * Get fleet status summary
   */
  getFleetStatus(): {
    total: number;
    online: number;
    offline: number;
    error: number;
    totalRam: number;
    totalCpu: number;
  } {
    const vms = this.getVms();
    
    return {
      total: vms.length,
      online: vms.filter(vm => vm.status === "online").length,
      offline: vms.filter(vm => vm.status === "offline").length,
      error: vms.filter(vm => vm.status === "error").length,
      totalRam: vms.reduce((sum, vm) => sum + vm.ram, 0),
      totalCpu: vms.reduce((sum, vm) => sum + vm.vcpu, 0),
    };
  }

  /**
   * Format VM info with color coding
   */
  formatVmInfo(vm: VmConfig): string {
    const status = vm.status ? `[${vm.status}]` : "";
    const latency = vm.responseTime ? `${vm.responseTime}ms` : "N/A";
    
    return `${vm.name} (${vm.id}) ${status} - ${latency} - trit:${vm.trit} - ${vm.color}`;
  }

  /**
   * Get or create session for a VM
   */
  getSession(vmId: string): VmSession {
    let session = this.sessions.get(vmId);
    
    if (!session) {
      session = {
        vmId,
        lastUsed: Date.now(),
        messageCount: 0,
      };
      this.sessions.set(vmId, session);
    }
    
    return session;
  }

  /**
   * Update session after interaction
   */
  updateSession(vmId: string, sessionId?: string): void {
    const session = this.getSession(vmId);
    
    session.lastUsed = Date.now();
    session.messageCount++;
    if (sessionId) {
      session.sessionId = sessionId;
    }
    
    this.sessions.set(vmId, session);
  }

  /**
   * Get session statistics
   */
  getSessionStats(): Map<string, VmSession> {
    return new Map(this.sessions);
  }

  /**
   * Format color for terminal output (ANSI escape codes)
   */
  getColorCode(vm: VmConfig): string {
    // Convert hex to RGB for ANSI 256 color approximation
    const hex = vm.color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // Simple mapping to 256-color palette
    const colorCode = 16 + 
      Math.floor(r / 51) * 36 + 
      Math.floor(g / 51) * 6 + 
      Math.floor(b / 51);
    
    return `\x1b[38;5;${colorCode}m`;
  }

  /**
   * Reset color
   */
  resetColor(): string {
    return '\x1b[0m';
  }

  /**
   * Format VM name with color
   */
  formatColoredName(vm: VmConfig): string {
    return `${this.getColorCode(vm)}${vm.name}${this.resetColor()}`;
  }
}

/**
 * Singleton instance
 */
let instance: MultiVmManager | null = null;

export function getMultiVmManager(configPath?: string): MultiVmManager {
  if (!instance) {
    instance = new MultiVmManager(configPath);
  }
  return instance;
}
