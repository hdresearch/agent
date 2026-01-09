// Fleet manager tests

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { fleetManager, type VmInfo } from "../../src/fleet";

describe("FleetManager", () => {
  beforeEach(() => {
    fleetManager.clear();
  });

  afterEach(() => {
    fleetManager.stopHealthChecks();
    fleetManager.clear();
  });

  describe("VM registration", () => {
    test("registerVm adds a VM", () => {
      const vm: VmInfo = {
        id: "test-vm",
        domain: "localhost",
        port: 9999,
        status: "offline",
      };

      fleetManager.registerVm(vm);

      expect(fleetManager.getVm("test-vm")).toEqual(vm);
      expect(fleetManager.getVms()).toHaveLength(1);
    });

    test("registerVm replaces existing VM", () => {
      const vm1: VmInfo = { id: "test", domain: "a.com", port: 9001, status: "offline" };
      const vm2: VmInfo = { id: "test", domain: "b.com", port: 9002, status: "online" };

      fleetManager.registerVm(vm1);
      fleetManager.registerVm(vm2);

      expect(fleetManager.getVm("test")?.domain).toBe("b.com");
      expect(fleetManager.getVms()).toHaveLength(1);
    });

    test("unregisterVm removes a VM", () => {
      fleetManager.registerVm({ id: "vm1", domain: "a", port: 1, status: "offline" });
      fleetManager.registerVm({ id: "vm2", domain: "b", port: 2, status: "offline" });

      const result = fleetManager.unregisterVm("vm1");

      expect(result).toBe(true);
      expect(fleetManager.getVms()).toHaveLength(1);
      expect(fleetManager.getVm("vm1")).toBeUndefined();
    });

    test("unregisterVm returns false for non-existent VM", () => {
      const result = fleetManager.unregisterVm("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("getCounts", () => {
    test("returns correct counts", () => {
      fleetManager.registerVm({ id: "vm1", domain: "a", port: 1, status: "online" });
      fleetManager.registerVm({ id: "vm2", domain: "b", port: 2, status: "online" });
      fleetManager.registerVm({ id: "vm3", domain: "c", port: 3, status: "offline" });
      fleetManager.registerVm({ id: "vm4", domain: "d", port: 4, status: "error" });

      const counts = fleetManager.getCounts();

      expect(counts.total).toBe(4);
      expect(counts.online).toBe(2);
      expect(counts.offline).toBe(1);
      expect(counts.error).toBe(1);
    });

    test("returns zero counts for empty fleet", () => {
      const counts = fleetManager.getCounts();

      expect(counts.total).toBe(0);
      expect(counts.online).toBe(0);
      expect(counts.offline).toBe(0);
      expect(counts.error).toBe(0);
    });
  });

  describe("getVmUrl", () => {
    test("returns https URL for ngrok domains", () => {
      const vm: VmInfo = { id: "test", domain: "test.ngrok.io", port: 9999, status: "online" };
      expect(fleetManager.getVmUrl(vm)).toBe("https://test.ngrok.io");
    });

    test("returns http URL with port for local domains", () => {
      const vm: VmInfo = { id: "test", domain: "localhost", port: 9999, status: "online" };
      expect(fleetManager.getVmUrl(vm)).toBe("http://localhost:9999");
    });

    test("returns http URL with port for custom domains", () => {
      const vm: VmInfo = { id: "test", domain: "192.168.1.100", port: 8080, status: "online" };
      expect(fleetManager.getVmUrl(vm)).toBe("http://192.168.1.100:8080");
    });
  });

  describe("getStatus", () => {
    test("returns fleet status summary", () => {
      fleetManager.registerVm({ id: "vm1", domain: "a", port: 1, status: "online" });

      const status = fleetManager.getStatus();

      expect(status.vms.size).toBe(1);
      expect(status.lastUpdate).toBeGreaterThan(0);
    });
  });

  describe("event subscription", () => {
    test("onEvent receives fleet_updated on register", () => {
      const events: unknown[] = [];
      const unsubscribe = fleetManager.onEvent((event) => {
        events.push(event);
      });

      fleetManager.registerVm({ id: "vm1", domain: "a", port: 1, status: "online" });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "fleet_updated" });

      unsubscribe();
    });

    test("onEvent receives fleet_updated on unregister", () => {
      fleetManager.registerVm({ id: "vm1", domain: "a", port: 1, status: "online" });

      const events: unknown[] = [];
      const unsubscribe = fleetManager.onEvent((event) => {
        events.push(event);
      });

      fleetManager.unregisterVm("vm1");

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "fleet_updated" });

      unsubscribe();
    });

    test("unsubscribe stops receiving events", () => {
      const events: unknown[] = [];
      const unsubscribe = fleetManager.onEvent((event) => {
        events.push(event);
      });

      unsubscribe();
      fleetManager.registerVm({ id: "vm1", domain: "a", port: 1, status: "online" });

      expect(events).toHaveLength(0);
    });
  });

  describe("clear", () => {
    test("removes all VMs", () => {
      fleetManager.registerVm({ id: "vm1", domain: "a", port: 1, status: "online" });
      fleetManager.registerVm({ id: "vm2", domain: "b", port: 2, status: "online" });

      fleetManager.clear();

      expect(fleetManager.getVms()).toHaveLength(0);
      expect(fleetManager.getCounts().total).toBe(0);
    });
  });
});
