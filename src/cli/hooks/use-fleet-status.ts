// Hook for tracking fleet VM status in the TUI
import { useState, useEffect, useCallback } from "react";
import { fleetManager, type VmInfo, type FleetEvent } from "../../fleet";

export interface FleetStatusInfo {
  vms: VmInfo[];
  counts: { total: number; online: number; offline: number; error: number };
  isMonitoring: boolean;
}

interface UseFleetStatusOptions {
  /** Auto-discover fleet from Docker containers */
  autoDiscover?: boolean;
  /** Path to fleet.yml config file */
  configPath?: string;
  /** Health check interval in ms (default: 30000) */
  healthCheckInterval?: number;
  /** Enable health monitoring */
  enableMonitoring?: boolean;
}

export function useFleetStatus(options: UseFleetStatusOptions = {}): FleetStatusInfo & {
  refreshStatus: () => Promise<void>;
  startMonitoring: () => void;
  stopMonitoring: () => void;
} {
  const {
    autoDiscover = true,
    configPath,
    healthCheckInterval = 30000,
    enableMonitoring = false,
  } = options;

  const [vms, setVms] = useState<VmInfo[]>([]);
  const [counts, setCounts] = useState({ total: 0, online: 0, offline: 0, error: 0 });
  const [isMonitoring, setIsMonitoring] = useState(false);

  const updateState = useCallback(() => {
    setVms(fleetManager.getVms());
    setCounts(fleetManager.getCounts());
  }, []);

  const refreshStatus = useCallback(async () => {
    if (autoDiscover) {
      await fleetManager.discoverFleet();
    }
    await fleetManager.checkAllHealth();
    updateState();
  }, [autoDiscover, updateState]);

  const startMonitoring = useCallback(() => {
    fleetManager.startHealthChecks(healthCheckInterval);
    setIsMonitoring(true);
  }, [healthCheckInterval]);

  const stopMonitoring = useCallback(() => {
    fleetManager.stopHealthChecks();
    setIsMonitoring(false);
  }, []);

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      // Load config if provided
      if (configPath) {
        await fleetManager.loadConfig(configPath);
      }

      // Auto-discover from Docker
      if (autoDiscover) {
        await fleetManager.discoverFleet();
      }

      // Initial health check
      await fleetManager.checkAllHealth();
      updateState();

      // Start monitoring if enabled
      if (enableMonitoring) {
        fleetManager.startHealthChecks(healthCheckInterval);
        setIsMonitoring(true);
      }
    };

    init().catch(() => {});

    // Subscribe to fleet events
    const unsubscribe = fleetManager.onEvent((event: FleetEvent) => {
      updateState();
    });

    return () => {
      unsubscribe();
      fleetManager.stopHealthChecks();
    };
  }, [autoDiscover, configPath, healthCheckInterval, enableMonitoring, updateState]);

  return {
    vms,
    counts,
    isMonitoring,
    refreshStatus,
    startMonitoring,
    stopMonitoring,
  };
}
