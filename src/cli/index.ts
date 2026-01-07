// CLI - Terminal UI

// Main entry point
export { runCli } from "./cli";

// Types
export type { CliOptions, OutputLine, AppState, StatusInfo, PathMatch, ProcessedImage } from "./types";

// Components (for potential reuse)
export * from "./components";

// Hooks (for potential reuse)
export * from "./hooks";

// Handlers (for potential reuse)
export * from "./handlers";

// Utilities
export * from "./utils";

// Constants
export { COMMANDS, TOOL_ICONS, MODEL_CONTEXT_LIMITS } from "./constants";
