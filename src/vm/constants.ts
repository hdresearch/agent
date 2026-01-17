/**
 * VM path constants
 *
 * These paths define where vers-agent and its data live inside VMs.
 * Override with VERS_VM_HOME environment variable if needed.
 */

export const VM_HOME_DIR = process.env.VERS_VM_HOME ?? "/root";
export const VM_AGENT_DIR = `${VM_HOME_DIR}/vers-agent`;
export const VM_VERS_AGENT_CONFIG_DIR = `${VM_HOME_DIR}/.vers-agent`;
