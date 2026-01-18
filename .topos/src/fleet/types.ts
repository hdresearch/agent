// Fleet VM types

export type VmStatus = "online" | "offline" | "starting" | "stopping" | "error";

export interface VmInfo {
  id: string;
  domain: string;
  port: number;
  status: VmStatus;
  health?: {
    lastCheck: number;
    responseTime?: number;
    error?: string;
  };
  group?: {
    name: string;
    patterns: string[];
    dids: string[];
  };
}

export interface FleetConfig {
  name: string;
  version: string;
  vms: VmInfo[];
}

export interface FleetStatus {
  config: FleetConfig | null;
  vms: Map<string, VmInfo>;
  lastUpdate: number;
}

export interface FleetEvent {
  type: "vm_status_changed" | "fleet_updated" | "health_check";
  vmId?: string;
  data: unknown;
  timestamp: number;
}
