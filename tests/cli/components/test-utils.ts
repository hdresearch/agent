// Test utilities for Ink component tests

import type {
  AppState,
  PermissionRequest,
  PermissionOption,
  PermissionToolCall,
  StatusInfo,
  OutputLine,
} from "../../../src/cli/types";

// Mock factory for AppState
export function createMockAppState(
  overrides: Partial<AppState> = {}
): AppState {
  return {
    status: "idle",
    ...overrides,
  };
}

// Mock factory for PermissionOption
export function createMockPermissionOption(
  overrides: Partial<PermissionOption> = {}
): PermissionOption {
  return {
    optionId: "test-option-1",
    kind: "allow_once",
    name: "Allow once",
    ...overrides,
  };
}

// Mock factory for PermissionToolCall
export function createMockPermissionToolCall(
  overrides: Partial<PermissionToolCall> = {}
): PermissionToolCall {
  return {
    toolCallId: "test-tool-call-1",
    title: "Test Tool",
    kind: "read",
    status: "pending",
    locations: [],
    ...overrides,
  };
}

// Mock factory for PermissionRequest
export function createMockPermissionRequest(
  overrides: Partial<PermissionRequest> = {}
): PermissionRequest {
  return {
    requestId: "test-request-1",
    toolCall: createMockPermissionToolCall(overrides.toolCall),
    options: overrides.options ?? [
      createMockPermissionOption({ optionId: "allow", kind: "allow_once", name: "Allow once" }),
      createMockPermissionOption({ optionId: "deny", kind: "reject_once", name: "Deny once" }),
    ],
  };
}

// Mock factory for StatusInfo
export function createMockStatusInfo(
  overrides: Partial<StatusInfo> = {}
): StatusInfo {
  return {
    model: "claude-sonnet-4-20250514",
    cost: {
      totalCost: 0.001,
      inputTokens: 100,
      outputTokens: 50,
    },
    planMode: false,
    sessionId: "test-session-1",
    ...overrides,
  };
}

// Mock factory for OutputLine
export function createMockOutputLine(
  overrides: Partial<OutputLine> = {}
): OutputLine {
  return {
    id: `line-${Date.now()}`,
    type: "text",
    content: "Test output",
    ...overrides,
  };
}

// Helper to wait for async effects
export function waitForEffects(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
