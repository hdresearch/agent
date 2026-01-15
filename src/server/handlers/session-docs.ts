// Session docs management handlers

import { getDocs, setDocs, getDocsStore, type StoredDoc, type DocsStore } from "../../utils/docs-store";
import { markDocsForReinjection, clearProjectDocsCache } from "../../core/agent-manager";

// ============================================================
// Session Docs Handlers
// ============================================================

export interface SessionReloadDocsResult {
  success: boolean;
  message: string;
}

export function handleSessionReloadDocs(): SessionReloadDocsResult {
  markDocsForReinjection();
  return { success: true, message: "Project docs will be re-injected on next message" };
}

export interface SessionGetDocsResult {
  docs: StoredDoc[];
  store: DocsStore;
}

export function handleSessionGetDocs(): SessionGetDocsResult {
  return {
    docs: getDocs(),
    store: getDocsStore(),
  };
}

export interface SessionSetDocsParams {
  docs: Array<{ name: string; content: string; path?: string }>;
}

export interface SessionSetDocsResult {
  success: boolean;
  docs: StoredDoc[];
  message: string;
}

export async function handleSessionSetDocs(params: SessionSetDocsParams): Promise<SessionSetDocsResult> {
  if (!params.docs || !Array.isArray(params.docs)) {
    throw new Error("Invalid docs parameter");
  }
  const updatedDocs = await setDocs(params.docs);
  clearProjectDocsCache(); // Force agent to reload from store
  return {
    success: true,
    docs: updatedDocs,
    message: `Updated ${updatedDocs.length} doc(s)`,
  };
}
