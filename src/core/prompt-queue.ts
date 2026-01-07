// Prompt queue for managing queued user commands
// Based on Claude Code's queuing patterns

import type { Attachment } from "../protocol/acp-types";

export interface QueuedPrompt {
  id: string;
  text: string;
  attachments?: Attachment[];
  queuedAt: Date;
  mode?: "default" | "plan";
}

export type QueueOperationType = "enqueue" | "dequeue" | "remove" | "flush";

export interface QueueOperation {
  type: "queue-operation";
  operation: QueueOperationType;
  timestamp: string;
  sessionId: string;
  promptId?: string;
  content?: string;
}

type QueueEventHandler = (event: QueueOperation) => void;

class PromptQueue {
  private queue: QueuedPrompt[] = [];
  private sessionId: string | null = null;
  private eventHandlers: Set<QueueEventHandler> = new Set();
  private processing = false;

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  private generateId(): string {
    return crypto.randomUUID();
  }

  private emitEvent(operation: QueueOperationType, promptId?: string, content?: string): void {
    const event: QueueOperation = {
      type: "queue-operation",
      operation,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId || "",
      promptId,
      content,
    };

    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  /**
   * Add a prompt to the queue
   */
  enqueue(text: string, attachments?: Attachment[], mode?: "default" | "plan"): QueuedPrompt {
    const prompt: QueuedPrompt = {
      id: this.generateId(),
      text,
      attachments,
      queuedAt: new Date(),
      mode,
    };

    this.queue.push(prompt);
    this.emitEvent("enqueue", prompt.id, text);

    return prompt;
  }

  /**
   * Remove and return the first prompt from the queue
   */
  dequeue(): QueuedPrompt | undefined {
    if (this.queue.length === 0) return undefined;

    const [first, ...rest] = this.queue;
    this.queue = rest;

    if (first) {
      this.emitEvent("dequeue", first.id);
    }

    return first;
  }

  /**
   * Get the first prompt without removing it
   */
  peek(): QueuedPrompt | undefined {
    return this.queue[0];
  }

  /**
   * Remove and return all prompts from the queue
   */
  flushAll(): QueuedPrompt[] {
    if (this.queue.length === 0) return [];

    const all = [...this.queue];
    this.queue = [];

    for (const prompt of all) {
      this.emitEvent("dequeue", prompt.id);
    }

    return all;
  }

  /**
   * Remove specific prompts by ID
   */
  remove(ids: string[]): QueuedPrompt[] {
    const removed: QueuedPrompt[] = [];
    const idSet = new Set(ids);

    this.queue = this.queue.filter((prompt) => {
      if (idSet.has(prompt.id)) {
        removed.push(prompt);
        this.emitEvent("remove", prompt.id);
        return false;
      }
      return true;
    });

    return removed;
  }

  /**
   * Get all queued prompts without removing them
   */
  getAll(): QueuedPrompt[] {
    return [...this.queue];
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Check if currently processing a prompt
   */
  get isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Set processing state
   */
  setProcessing(value: boolean): void {
    this.processing = value;
  }

  /**
   * Clear the entire queue
   */
  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    this.emitEvent("flush");
  }

  /**
   * Subscribe to queue events
   */
  onEvent(handler: QueueEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  /**
   * Serialize queue state for persistence
   */
  serialize(): { prompts: QueuedPrompt[]; sessionId: string | null } {
    return {
      prompts: this.queue.map((p) => ({
        ...p,
        queuedAt: p.queuedAt,
      })),
      sessionId: this.sessionId,
    };
  }

  /**
   * Restore queue state from persistence
   */
  restore(data: { prompts: QueuedPrompt[]; sessionId: string | null }): void {
    this.queue = data.prompts.map((p) => ({
      ...p,
      queuedAt: new Date(p.queuedAt),
    }));
    this.sessionId = data.sessionId;
  }
}

// Singleton instance
export const promptQueue = new PromptQueue();

// Helper to process queued prompts sequentially
export async function processQueue(
  processor: (prompt: QueuedPrompt) => Promise<void>
): Promise<void> {
  if (promptQueue.isProcessing) {
    return; // Already processing
  }

  promptQueue.setProcessing(true);

  try {
    while (!promptQueue.isEmpty) {
      const prompt = promptQueue.dequeue();
      if (prompt) {
        await processor(prompt);
      }
    }
  } finally {
    promptQueue.setProcessing(false);
  }
}
