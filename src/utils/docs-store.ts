// Project documentation storage
// Persists to ~/.vers/project_docs.json
// Stores CLAUDE.md, AGENT.md, AGENTS.md content

import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".vers");
const DOCS_FILE = join(CONFIG_DIR, "project_docs.json");

export interface StoredDoc {
  name: string;        // e.g., "CLAUDE.md"
  path: string;        // Original path where it was found
  content: string;     // File content
  updatedAt: string;   // ISO timestamp
}

export interface DocsStore {
  docs: StoredDoc[];
  autoLoaded: boolean; // true if loaded from filesystem, false if set via API
  loadedAt: string;    // When docs were last loaded
}

const defaultStore: DocsStore = {
  docs: [],
  autoLoaded: false,
  loadedAt: new Date().toISOString(),
};

let store: DocsStore = { ...defaultStore };

async function ensureConfigDir(): Promise<void> {
  const proc = Bun.spawn(["mkdir", "-p", CONFIG_DIR], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

// Load docs from persistent storage
export async function loadDocsStore(): Promise<DocsStore> {
  try {
    const file = Bun.file(DOCS_FILE);
    if (await file.exists()) {
      const text = await file.text();
      store = JSON.parse(text) as DocsStore;
    }
  } catch (err) {
    console.error("Failed to load docs store:", err);
    store = { ...defaultStore };
  }
  return getDocsStore();
}

// Save docs to persistent storage
export async function saveDocsStore(): Promise<void> {
  try {
    await ensureConfigDir();
    await Bun.write(DOCS_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error("Failed to save docs store:", err);
  }
}

// Get current docs store
export function getDocsStore(): DocsStore {
  return { ...store, docs: [...store.docs] };
}

// Get all docs
export function getDocs(): StoredDoc[] {
  return [...store.docs];
}

// Get a specific doc by name
export function getDoc(name: string): StoredDoc | null {
  return store.docs.find(d => d.name.toLowerCase() === name.toLowerCase()) || null;
}

// Set a doc (add or update)
export async function setDoc(name: string, content: string, path?: string): Promise<StoredDoc> {
  const now = new Date().toISOString();
  const existing = store.docs.findIndex(d => d.name.toLowerCase() === name.toLowerCase());

  const doc: StoredDoc = {
    name,
    path: path || name,
    content,
    updatedAt: now,
  };

  if (existing >= 0) {
    store.docs[existing] = doc;
  } else {
    store.docs.push(doc);
  }

  store.autoLoaded = false;
  store.loadedAt = now;

  await saveDocsStore();
  return doc;
}

// Set multiple docs at once (replaces all)
export async function setDocs(docs: Array<{ name: string; content: string; path?: string }>): Promise<StoredDoc[]> {
  const now = new Date().toISOString();

  store.docs = docs.map(d => ({
    name: d.name,
    path: d.path || d.name,
    content: d.content,
    updatedAt: now,
  }));

  store.autoLoaded = false;
  store.loadedAt = now;

  await saveDocsStore();
  return getDocs();
}

// Set docs from auto-loaded filesystem scan
export async function setDocsFromFilesystem(docs: Array<{ name: string; content: string; path: string }>): Promise<void> {
  const now = new Date().toISOString();

  store.docs = docs.map(d => ({
    name: d.name,
    path: d.path,
    content: d.content,
    updatedAt: now,
  }));

  store.autoLoaded = true;
  store.loadedAt = now;

  await saveDocsStore();
}

// Remove a doc by name
export async function removeDoc(name: string): Promise<boolean> {
  const idx = store.docs.findIndex(d => d.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    store.docs.splice(idx, 1);
    await saveDocsStore();
    return true;
  }
  return false;
}

// Clear all docs
export async function clearDocs(): Promise<void> {
  store.docs = [];
  store.autoLoaded = false;
  store.loadedAt = new Date().toISOString();
  await saveDocsStore();
}

// Format docs for system prompt
export function formatStoredDocsAsSystemPrompt(): string {
  if (store.docs.length === 0) {
    return "";
  }

  const sections = store.docs.map((d) => {
    return `<project-doc source="${d.path}">\n${d.content}\n</project-doc>`;
  });

  return `The following project documentation files were found. Follow any instructions they contain:\n\n${sections.join("\n\n")}`;
}

// Format docs for re-injection after compaction
export function formatStoredDocsForReinjection(): string {
  if (store.docs.length === 0) {
    return "";
  }

  const sections = store.docs.map((d) => {
    return `<project-doc source="${d.path}">\n${d.content}\n</project-doc>`;
  });

  return `<context-refresh reason="compaction">
The conversation context was compacted. Here are the project documentation files again for reference:

${sections.join("\n\n")}
</context-refresh>

`;
}
