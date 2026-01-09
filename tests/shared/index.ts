// Shared test utilities barrel export
// Import from "../../tests/shared" or "../shared" depending on location

// Synchronization primitives
export {
  createDeferred,
  waitUntil,
  withTimeout,
  flushAsync,
  waitForEvent,
  waitForEvents,
  retry,
  type Deferred,
  type WaitUntilOptions,
  type RetryOptions,
} from "./sync";

// Mock factories
export {
  createMockAppState,
  createMockPermissionOption,
  createMockPermissionToolCall,
  createMockPermissionRequest,
  createMockStatusInfo,
  createMockOutputLine,
  createMockOutputLines,
} from "./mocks";

// Ink component test utilities
export {
  renderInk,
  createInkTestHarness,
  waitForFrame,
  waitForStableFrame,
  inkGlobalCleanup,
  type InkRenderResult,
} from "./ink";

// Docker test utilities
export {
  // Types
  type DockerTestContext,
  type Session,
  type RpcResponse,
  type EventStreamConnection,

  // Configuration
  TEST_SERVER_URL,

  // Server health
  waitForHealthy,
  isDockerServerRunning,

  // Test context
  createTestContext,

  // RPC utilities
  makeRpcCall,
  makeRpcCallWithRetry,

  // Session management
  initializeConnection,
  createSession,
  listSessions,
  cleanupSessions,

  // Event stream
  connectToEventStream,

  // Test harness
  DockerTestHarness,

  // Skip helpers
  skipIfNoDocker,

  // Wait utilities
  waitForSessionState,
  waitForSessionOutput,

  // Token management
  TokenManager,
} from "./docker";
