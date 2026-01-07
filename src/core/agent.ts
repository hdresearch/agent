import { taskStore } from "./tasks";
import { runQuery, type QueryHandle, type AnyQueryEvent } from "./query-runner";
import { readProjectDocs, type ProjectDocs } from "../utils/project-docs";
import {
  getDocs,
  setDocsFromFilesystem,
  formatStoredDocsAsSystemPrompt,
  formatStoredDocsForReinjection,
  loadDocsStore,
} from "../utils/docs-store";
import { processImagesInPrompt, type ProcessedImage } from "../utils/image-utils";

// Track running query handles for cancellation
const runningQueries: Map<string, QueryHandle> = new Map();

// Cache project docs to avoid re-reading on every task
let cachedProjectDocs: ProjectDocs | null = null;
let cachedProjectDocsCwd: string | null = null;

// Flag to track if docs need re-injection (after compaction)
let needsDocsReinjection = false;

// Patterns that indicate context was compacted/summarized
const COMPACTION_PATTERNS = [
  /context was (compacted|summarized|truncated)/i,
  /conversation (history )?(was |has been )?(compacted|summarized|truncated)/i,
  /summariz(e|ed|ing) (the |our )?(conversation|context|history)/i,
  /automatic summarization/i,
  /context limit/i,
];

async function ensureDocsLoaded(cwd: string): Promise<void> {
  // Check if docs are already in store
  const storedDocs = getDocs();
  if (storedDocs.length > 0) {
    // Already have docs in store
    if (!cachedProjectDocsCwd || cachedProjectDocsCwd !== cwd) {
      cachedProjectDocsCwd = cwd;
      console.log(`Using stored project docs: ${storedDocs.map(d => d.name).join(", ")}`);
    }
    return;
  }

  // No docs in store, try to load from filesystem
  if (!cachedProjectDocs || cachedProjectDocsCwd !== cwd) {
    cachedProjectDocs = await readProjectDocs(cwd);
    cachedProjectDocsCwd = cwd;

    // Store the loaded docs
    if (cachedProjectDocs.files.length > 0) {
      await setDocsFromFilesystem(cachedProjectDocs.files.map(f => ({
        name: f.name,
        path: f.path,
        content: f.content,
      })));
      console.log(`Loaded and stored project docs: ${cachedProjectDocs.files.map(f => f.name).join(", ")}`);
    }
  }
}

// Clear cached docs (call on new session to force re-read)
export function clearProjectDocsCache(): void {
  cachedProjectDocs = null;
  cachedProjectDocsCwd = null;
  needsDocsReinjection = false;
}

// Mark that docs need re-injection (e.g., after compaction detected)
export function markDocsForReinjection(): void {
  needsDocsReinjection = true;
}

// Check if text indicates compaction occurred
function detectCompaction(text: string): boolean {
  return COMPACTION_PATTERNS.some(pattern => pattern.test(text));
}

// Debug logging
const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";

function debug(...args: unknown[]): void {
  if (DEBUG) {
    console.log("[DEBUG][agent]", new Date().toISOString(), ...args);
  }
}

function info(...args: unknown[]): void {
  console.log("[INFO][agent]", new Date().toISOString(), ...args);
}

function error(...args: unknown[]): void {
  console.error("[ERROR][agent]", new Date().toISOString(), ...args);
}

export async function runTask(taskId: string): Promise<void> {
  info("runTask called:", taskId);

  const task = taskStore.get(taskId);
  if (!task) {
    error("Task not found:", taskId);
    throw new Error(`Task ${taskId} not found`);
  }

  info("Task prompt:", task.prompt.slice(0, 100));
  taskStore.updateStatus(taskId, "running");
  taskStore.addEvent(taskId, "started");

  try {
    const taskConfig = task.config;
    const cwd = taskConfig.cwd || process.cwd();
    info("Task config:", { cwd, model: taskConfig.model, maxTurns: taskConfig.maxTurns });

    // Ensure project docs are loaded (from store or filesystem)
    await ensureDocsLoaded(cwd);

    // Build system prompt from stored docs
    const docsPrompt = formatStoredDocsAsSystemPrompt();

    // Combine project docs with any existing system prompt
    let systemPrompt = taskConfig.systemPrompt || "";
    if (docsPrompt) {
      systemPrompt = docsPrompt + (systemPrompt ? "\n\n" + systemPrompt : "");
    }

    // If docs need re-injection (after compaction), prepend to prompt
    let prompt = task.prompt;
    const storedDocs = getDocs();
    if (needsDocsReinjection && storedDocs.length > 0) {
      const reinjectionText = formatStoredDocsForReinjection();
      prompt = reinjectionText + prompt;
      needsDocsReinjection = false;
      console.log("Re-injected project docs after compaction");
    }

    // Check for pre-processed attachments from CLI (already base64 encoded)
    let images: ProcessedImage[] = [];
    if (task.attachments && task.attachments.length > 0) {
      // Convert attachments to ProcessedImage format
      let imageId = 0;
      for (const attachment of task.attachments) {
        if (attachment.type === "image" && attachment.content) {
          imageId++;
          images.push({
            id: imageId,
            path: `attachment-${imageId}`,
            mediaType: (attachment.mimeType || "image/png") as ProcessedImage["mediaType"],
            base64: attachment.content,
          });
        }
      }
      if (images.length > 0) {
        console.log(`Using ${images.length} pre-processed image attachment(s) from CLI`);
      }
    } else {
      // Fall back to processing images from prompt text (for direct API calls)
      const imageResult = await processImagesInPrompt(prompt, cwd);
      if (imageResult.images.length > 0) {
        images = imageResult.images;
        prompt = imageResult.textPrompt; // Use modified prompt with image refs replaced
        console.log(`Processed ${images.length} image(s) from prompt`);
      }
      if (imageResult.errors.length > 0) {
        for (const err of imageResult.errors) {
          console.warn(`Image warning: ${err}`);
        }
      }
    }

    const handle = runQuery({
      prompt,
      model: taskConfig.model, // Will fall back to global config if not specified
      systemPrompt: systemPrompt || undefined,
      cwd,
      maxTurns: taskConfig.maxTurns ?? 50,
      maxBudgetUsd: taskConfig.maxBudgetUsd,
      allowedTools: taskConfig.allowedTools,
      permissionMode: taskConfig.permissionMode ?? "bypassPermissions",
      images, // Pass processed images
    });

    runningQueries.set(taskId, handle);

    let currentText = "";

    for await (const event of handle.events) {
      const e = event as AnyQueryEvent;

      switch (e.type) {
        case "text_delta":
          currentText += e.data.text;
          break;

        case "text_complete":
          taskStore.addEvent(taskId, "assistant_message", { text: e.data.text });
          currentText = ""; // Clear so we don't duplicate at end of loop

          // Check for compaction indicators
          if (detectCompaction(e.data.text)) {
            needsDocsReinjection = true;
            taskStore.addEvent(taskId, "system_message", {
              text: "Context compaction detected - project docs will be re-injected on next message",
            });
            console.log("Compaction detected - will re-inject project docs");
          }
          break;

        case "tool_use":
          taskStore.addEvent(taskId, "tool_use", {
            toolName: e.data.name,
            toolInput: e.data.input,
          });
          break;

        case "tool_result":
          taskStore.addEvent(taskId, "tool_result", {
            toolUseId: e.data.toolUseId,
            content: e.data.content,
          });
          break;

        case "result":
          taskStore.setResult(taskId, {
            success: e.data.success,
            durationMs: e.data.durationMs,
            totalCostUsd: e.data.totalCostUsd,
            numTurns: e.data.numTurns,
            usage: {
              inputTokens: e.data.inputTokens,
              outputTokens: e.data.outputTokens,
            },
          });
          // Note: session stats are already updated by query-runner
          break;

        case "error":
          taskStore.setError(taskId, e.data.message);
          taskStore.updateStatus(taskId, "failed");
          taskStore.addEvent(taskId, "failed", { error: e.data.message });
          return;

        case "cancelled":
          taskStore.updateStatus(taskId, "cancelled");
          taskStore.addEvent(taskId, "cancelled");
          return;
      }
    }

    // If we have accumulated text but no text_complete event, add it now
    if (currentText) {
      taskStore.addEvent(taskId, "assistant_message", { text: currentText });
    }

    // Check final status
    const finalTask = taskStore.get(taskId);
    if (finalTask?.status !== "cancelled") {
      taskStore.updateStatus(taskId, "completed");
      // Include cost/usage data in the completed event
      taskStore.addEvent(taskId, "completed", {
        durationMs: finalTask.result?.durationMs || 0,
        totalCostUsd: finalTask.result?.totalCostUsd || 0,
        numTurns: finalTask.result?.numTurns || 0,
        inputTokens: finalTask.result?.usage?.inputTokens || 0,
        outputTokens: finalTask.result?.usage?.outputTokens || 0,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Check if this was a cancellation
    if (errorMessage.includes("aborted") || errorMessage.includes("interrupted")) {
      taskStore.updateStatus(taskId, "cancelled");
      taskStore.addEvent(taskId, "cancelled");
    } else {
      taskStore.setError(taskId, errorMessage);
      taskStore.updateStatus(taskId, "failed");
      taskStore.addEvent(taskId, "failed", { error: errorMessage });
    }
  } finally {
    runningQueries.delete(taskId);
  }
}

export async function cancelTask(taskId: string): Promise<boolean> {
  const handle = runningQueries.get(taskId);
  if (handle) {
    taskStore.updateStatus(taskId, "cancelled");
    await handle.cancel();
    return true;
  }
  return false;
}

export function isTaskRunning(taskId: string): boolean {
  return runningQueries.has(taskId);
}
