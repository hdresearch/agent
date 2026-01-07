import type { Task, TaskConfig, TaskEvent, TaskEventType, TaskResult, TaskStatus, TaskAttachment } from "./types";

function generateId(): string {
  return crypto.randomUUID();
}

export class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private subscribers: Map<string, Set<(event: TaskEvent) => void>> = new Map();

  create(prompt: string, config: TaskConfig = {}, attachments?: TaskAttachment[]): Task {
    const task: Task = {
      id: generateId(),
      prompt,
      config,
      status: "pending",
      createdAt: new Date(),
      events: [],
      attachments,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(): Task[] {
    return Array.from(this.tasks.values());
  }

  updateStatus(id: string, status: TaskStatus): void {
    const task = this.tasks.get(id);
    if (!task) return;

    task.status = status;
    if (status === "running" && !task.startedAt) {
      task.startedAt = new Date();
    }
    if (status === "completed" || status === "failed" || status === "cancelled") {
      task.completedAt = new Date();
    }
  }

  setResult(id: string, result: TaskResult): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.result = result;
  }

  setError(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.error = error;
  }

  addEvent(id: string, type: TaskEventType, data: unknown = {}): TaskEvent {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task ${id} not found`);

    const event: TaskEvent = {
      id: generateId(),
      type,
      timestamp: new Date(),
      data,
    };
    task.events.push(event);

    // Notify subscribers
    const subs = this.subscribers.get(id);
    if (subs) {
      for (const callback of subs) {
        callback(event);
      }
    }

    return event;
  }

  subscribe(id: string, callback: (event: TaskEvent) => void): () => void {
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set());
    }
    this.subscribers.get(id)!.add(callback);

    return () => {
      this.subscribers.get(id)?.delete(callback);
    };
  }

  delete(id: string): boolean {
    this.subscribers.delete(id);
    return this.tasks.delete(id);
  }
}

export const taskStore = new TaskStore();
