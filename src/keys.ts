// API key detection and management
// Detects keys from environment, syncs between CLI and server

import { createHash } from "crypto";

// API keys that vers-agent can detect and pass to VMs
export const KNOWN_API_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "DEEPSEEK_API_KEY",
  "XAI_API_KEY",
  "COHERE_API_KEY",
  "PERPLEXITY_API_KEY",
  "REPLICATE_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "VOYAGE_API_KEY",
  "ELEVENLABS_API_KEY",
  "GITHUB_TOKEN",
  "VERS_API_KEY",
] as const;

export type KnownApiKey = (typeof KNOWN_API_KEYS)[number];

export interface DetectedKey {
  name: string;
  value: string;
  redacted: string;
}

export interface KeysState {
  keys: Record<string, string>;
  hash: string;
  detectedAt: string;
}

// Detect API keys from current environment
export function detectKeys(): DetectedKey[] {
  const detected: DetectedKey[] = [];

  for (const keyName of KNOWN_API_KEYS) {
    const value = process.env[keyName];
    if (value && value.trim()) {
      detected.push({
        name: keyName,
        value: value.trim(),
        redacted: redactKey(value.trim()),
      });
    }
  }

  return detected;
}

// Redact a key for display (show first 8 chars + ...)
export function redactKey(value: string): string {
  if (value.length <= 8) {
    return "***";
  }
  return value.slice(0, 8) + "...";
}

// Compute secure hash of keys for comparison
export function computeKeysHash(keys: Record<string, string>): string {
  // Sort keys for consistent hashing
  const sorted = Object.keys(keys)
    .sort()
    .map((k) => `${k}=${keys[k]}`)
    .join("\n");

  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

// Convert detected keys to a state object
export function keysToState(detected: DetectedKey[]): KeysState {
  const keys: Record<string, string> = {};
  for (const k of detected) {
    keys[k.name] = k.value;
  }

  return {
    keys,
    hash: computeKeysHash(keys),
    detectedAt: new Date().toISOString(),
  };
}

// Keys storage path
export function getKeysPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return `${home}/.vers/keys.json`;
}

// Load keys from disk
export async function loadStoredKeys(): Promise<KeysState | null> {
  try {
    const path = getKeysPath();
    const file = Bun.file(path);
    if (await file.exists()) {
      const data = await file.json();
      return data as KeysState;
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return null;
}

// Save keys to disk
export async function saveKeys(state: KeysState): Promise<void> {
  const path = getKeysPath();
  const dir = path.replace(/\/[^/]+$/, "");

  // Ensure ~/.vers directory exists
  try {
    await Bun.write(Bun.file(`${dir}/.keep`), "");
  } catch {
    // Directory might already exist
  }

  await Bun.write(path, JSON.stringify(state, null, 2));
}

// Format keys for display
export function formatKeysDisplay(
  detected: DetectedKey[],
  serverHash?: string | null
): string {
  const lines: string[] = [];
  const localHash = computeKeysHash(
    Object.fromEntries(detected.map((k) => [k.name, k.value]))
  );

  lines.push("🔑 Detected API Keys:");
  lines.push("");

  if (detected.length === 0) {
    lines.push("  (none found in environment)");
  } else {
    for (const key of detected) {
      lines.push(`  ✅ ${key.name}: ${key.redacted}`);
    }
  }

  lines.push("");
  lines.push(`Local hash:  ${localHash}`);

  if (serverHash !== undefined) {
    lines.push(`Server hash: ${serverHash || "(no keys stored)"}`);
    if (serverHash && localHash === serverHash) {
      lines.push("✓ Keys are in sync");
    } else if (serverHash) {
      lines.push("⚠ Keys differ - will sync to server");
    } else {
      lines.push("→ Will upload keys to server");
    }
  }

  return lines.join("\n");
}
