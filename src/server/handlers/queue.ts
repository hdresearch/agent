// Queue management handlers

import { promptQueue, type QueuedPrompt } from "../../core/prompt-queue";
import type {
  QueueEnqueueParams,
  QueueEnqueueResult,
  QueueDequeueResult,
  QueuePeekResult,
  QueueListResult,
  QueueRemoveParams,
  QueueRemoveResult,
  QueueClearResult,
  QueuedPromptInfo,
} from "../../protocol/acp-types";

// Convert QueuedPrompt to QueuedPromptInfo for API response
function toQueuedPromptInfo(prompt: QueuedPrompt): QueuedPromptInfo {
  return {
    id: prompt.id,
    text: prompt.text,
    attachments: prompt.attachments,
    queuedAt: prompt.queuedAt.toISOString(),
    mode: prompt.mode,
  };
}

export function handleQueueEnqueue(params: QueueEnqueueParams): QueueEnqueueResult {
  if (!params.text) {
    throw new Error("Missing text parameter");
  }
  // Filter mode to only valid queue modes (execute is not valid for queue)
  const queueMode = params.mode === "execute" ? undefined : params.mode;
  const queued = promptQueue.enqueue(params.text, params.attachments, queueMode);
  return {
    id: queued.id,
    position: promptQueue.length,
  };
}

export function handleQueueDequeue(): QueueDequeueResult {
  const dequeued = promptQueue.dequeue();
  return {
    prompt: dequeued ? toQueuedPromptInfo(dequeued) : null,
    remaining: promptQueue.length,
  };
}

export function handleQueuePeek(): QueuePeekResult {
  const peeked = promptQueue.peek();
  return {
    prompt: peeked ? toQueuedPromptInfo(peeked) : null,
    queueLength: promptQueue.length,
  };
}

export function handleQueueList(): QueueListResult {
  const all = promptQueue.getAll();
  return {
    prompts: all.map(toQueuedPromptInfo),
    processing: promptQueue.isProcessing,
  };
}

export function handleQueueRemove(params: QueueRemoveParams): QueueRemoveResult {
  if (!params.ids || !Array.isArray(params.ids)) {
    throw new Error("Missing or invalid ids parameter");
  }
  const removed = promptQueue.remove(params.ids);
  return {
    removed: removed.length,
    remaining: promptQueue.length,
  };
}

export function handleQueueClear(): QueueClearResult {
  const count = promptQueue.length;
  promptQueue.clear();
  return {
    cleared: count,
  };
}
