// Conversation history storage
// Stores messages in ~/.vers/conversation.json

import { homedir } from "os";
import { join } from "path";
import { logStream } from "./log-stream";

const CONFIG_DIR = join(homedir(), ".vers");
const HISTORY_FILE = join(CONFIG_DIR, "conversation.json");

export interface HistoryMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp: string;
  toolName?: string;
}

export interface ConversationHistory {
  sessionId: string;
  messages: HistoryMessage[];
  createdAt: string;
  updatedAt: string;
}

async function ensureConfigDir(): Promise<void> {
  const proc = Bun.spawn(["mkdir", "-p", CONFIG_DIR], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

export async function loadHistory(): Promise<ConversationHistory | null> {
  try {
    const file = Bun.file(HISTORY_FILE);
    if (await file.exists()) {
      const text = await file.text();
      return JSON.parse(text) as ConversationHistory;
    }
  } catch (err) {
    logStream.error("[history] Failed to load conversation history", { error: err instanceof Error ? err.message : String(err) });
  }
  return null;
}

export async function saveHistory(history: ConversationHistory): Promise<void> {
  try {
    await ensureConfigDir();
    await Bun.write(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    logStream.error("[history] Failed to save conversation history", { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function clearHistory(): Promise<void> {
  try {
    const file = Bun.file(HISTORY_FILE);
    if (await file.exists()) {
      await Bun.write(HISTORY_FILE, "");
    }
  } catch (err) {
    logStream.error("[history] Failed to clear conversation history", { error: err instanceof Error ? err.message : String(err) });
  }
}

export function createHistory(sessionId: string): ConversationHistory {
  const now = new Date().toISOString();
  return {
    sessionId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function addMessage(
  history: ConversationHistory,
  role: HistoryMessage["role"],
  content: string,
  toolName?: string
): ConversationHistory {
  history.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
    toolName,
  });
  history.updatedAt = new Date().toISOString();
  return history;
}
