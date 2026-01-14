/**
 * Project type detection for evaluation commands
 * Auto-detects build/test/lint commands based on project files
 * Bun gets first-class treatment!
 */

import { exists } from "node:fs/promises";
import { join } from "node:path";

export interface EvalCommands {
  build?: string;
  test?: string;
  lint?: string;
  typecheck?: string;
}

export interface ProjectDetection {
  type: ProjectType;
  commands: EvalCommands;
  confidence: number; // 0-1, how confident we are in detection
}

export type ProjectType =
  | "bun"
  | "node"
  | "deno"
  | "rust"
  | "go"
  | "python"
  | "ruby"
  | "make"
  | "unknown";

/**
 * Detect project type and return appropriate eval commands
 * Priority: Bun > Node > Deno > Rust > Go > Python > Ruby > Make > Unknown
 */
export async function detectProject(cwd: string): Promise<ProjectDetection> {
  // Check for Bun first (our favorite!)
  const bunDetection = await detectBun(cwd);
  if (bunDetection) return bunDetection;

  // Check other project types
  const detectors = [
    detectNode,
    detectDeno,
    detectRust,
    detectGo,
    detectPython,
    detectRuby,
    detectMake,
  ];

  for (const detector of detectors) {
    const detection = await detector(cwd);
    if (detection) return detection;
  }

  return {
    type: "unknown",
    commands: {},
    confidence: 0,
  };
}

async function detectBun(cwd: string): Promise<ProjectDetection | null> {
  // Check for bun.lock (v1.x text format) or bun.lockb (v0.x binary format)
  const hasBunLock = await exists(join(cwd, "bun.lock"));
  const hasBunLockb = await exists(join(cwd, "bun.lockb"));
  // Check for bunfig.toml
  const hasBunConfig = await exists(join(cwd, "bunfig.toml"));
  // Check for package.json (needed for scripts)
  const hasPackageJson = await exists(join(cwd, "package.json"));

  if (hasBunLock || hasBunLockb || hasBunConfig) {
    const commands: EvalCommands = {
      build: "bun run build",
      test: "bun test",
      lint: "bun run lint",
      typecheck: "bun run typecheck",
    };

    // Check if scripts exist in package.json
    if (hasPackageJson) {
      try {
        const pkg = await Bun.file(join(cwd, "package.json")).json();
        const scripts = pkg.scripts || {};

        // Only include commands that have corresponding scripts
        if (!scripts.build) commands.build = undefined;
        if (!scripts.lint) commands.lint = undefined;
        if (!scripts.typecheck && !scripts["type-check"]) {
          // Try tsc directly if available
          const hasTsConfig = await exists(join(cwd, "tsconfig.json"));
          commands.typecheck = hasTsConfig ? "bun run tsc --noEmit" : undefined;
        }
      } catch {
        // Ignore parse errors
      }
    }

    return {
      type: "bun",
      commands,
      confidence: (hasBunLock || hasBunLockb) ? 1.0 : 0.9,
    };
  }

  return null;
}

async function detectNode(cwd: string): Promise<ProjectDetection | null> {
  const hasPackageJson = await exists(join(cwd, "package.json"));
  const hasPackageLock = await exists(join(cwd, "package-lock.json"));
  const hasYarnLock = await exists(join(cwd, "yarn.lock"));
  const hasPnpmLock = await exists(join(cwd, "pnpm-lock.yaml"));

  if (!hasPackageJson) return null;

  // Determine package manager
  let pm = "npm";
  if (hasPnpmLock) pm = "pnpm";
  else if (hasYarnLock) pm = "yarn";

  const commands: EvalCommands = {
    build: `${pm} run build`,
    test: `${pm} test`,
    lint: `${pm} run lint`,
    typecheck: `${pm} run typecheck`,
  };

  // Check if scripts exist
  try {
    const pkg = await Bun.file(join(cwd, "package.json")).json();
    const scripts = pkg.scripts || {};

    if (!scripts.build) commands.build = undefined;
    if (!scripts.test) commands.test = undefined;
    if (!scripts.lint) commands.lint = undefined;
    if (!scripts.typecheck) commands.typecheck = undefined;
  } catch {
    // Ignore parse errors
  }

  return {
    type: "node",
    commands,
    confidence: hasPackageLock || hasYarnLock || hasPnpmLock ? 0.9 : 0.7,
  };
}

async function detectDeno(cwd: string): Promise<ProjectDetection | null> {
  const hasDenoJson = await exists(join(cwd, "deno.json"));
  const hasDenoJsonc = await exists(join(cwd, "deno.jsonc"));

  if (!hasDenoJson && !hasDenoJsonc) return null;

  return {
    type: "deno",
    commands: {
      test: "deno test",
      lint: "deno lint",
      typecheck: "deno check **/*.ts",
    },
    confidence: 0.95,
  };
}

async function detectRust(cwd: string): Promise<ProjectDetection | null> {
  const hasCargoToml = await exists(join(cwd, "Cargo.toml"));

  if (!hasCargoToml) return null;

  return {
    type: "rust",
    commands: {
      build: "cargo build",
      test: "cargo test",
      lint: "cargo clippy -- -D warnings",
      typecheck: "cargo check",
    },
    confidence: 1.0,
  };
}

async function detectGo(cwd: string): Promise<ProjectDetection | null> {
  const hasGoMod = await exists(join(cwd, "go.mod"));

  if (!hasGoMod) return null;

  return {
    type: "go",
    commands: {
      build: "go build ./...",
      test: "go test ./...",
      lint: "golangci-lint run",
      typecheck: "go vet ./...",
    },
    confidence: 1.0,
  };
}

async function detectPython(cwd: string): Promise<ProjectDetection | null> {
  const hasPyproject = await exists(join(cwd, "pyproject.toml"));
  const hasRequirements = await exists(join(cwd, "requirements.txt"));
  const hasSetupPy = await exists(join(cwd, "setup.py"));

  if (!hasPyproject && !hasRequirements && !hasSetupPy) return null;

  // Check for common test/lint tools
  let testCmd = "pytest";
  let lintCmd = "ruff check .";

  // Check pyproject.toml for tool config
  if (hasPyproject) {
    try {
      const content = await Bun.file(join(cwd, "pyproject.toml")).text();
      if (content.includes("[tool.pytest]") || content.includes("pytest")) {
        testCmd = "pytest";
      }
      if (content.includes("[tool.ruff]")) {
        lintCmd = "ruff check .";
      } else if (content.includes("[tool.flake8]")) {
        lintCmd = "flake8";
      }
    } catch {
      // Ignore
    }
  }

  return {
    type: "python",
    commands: {
      test: testCmd,
      lint: lintCmd,
      typecheck: "mypy .",
    },
    confidence: hasPyproject ? 0.9 : 0.7,
  };
}

async function detectRuby(cwd: string): Promise<ProjectDetection | null> {
  const hasGemfile = await exists(join(cwd, "Gemfile"));

  if (!hasGemfile) return null;

  return {
    type: "ruby",
    commands: {
      test: "bundle exec rspec",
      lint: "bundle exec rubocop",
    },
    confidence: 0.8,
  };
}

async function detectMake(cwd: string): Promise<ProjectDetection | null> {
  const hasMakefile = await exists(join(cwd, "Makefile"));

  if (!hasMakefile) return null;

  // Check what targets exist in Makefile
  const commands: EvalCommands = {};

  try {
    const content = await Bun.file(join(cwd, "Makefile")).text();
    if (/^build:/m.test(content) || /^all:/m.test(content)) {
      commands.build = "make build";
    }
    if (/^test:/m.test(content)) {
      commands.test = "make test";
    }
    if (/^lint:/m.test(content)) {
      commands.lint = "make lint";
    }
    if (/^check:/m.test(content)) {
      commands.typecheck = "make check";
    }
  } catch {
    // Default to common targets
    commands.build = "make";
    commands.test = "make test";
  }

  return {
    type: "make",
    commands,
    confidence: 0.6, // Lower confidence since Makefile could be anything
  };
}
