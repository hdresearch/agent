// Log streaming for real-time debugging

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

type LogListener = (entry: LogEntry) => void;

class LogStream {
  private listeners: Set<LogListener> = new Set();
  private buffer: LogEntry[] = [];
  private maxBufferSize = 1000;

  // Subscribe to log stream
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Get listener count
  get listenerCount(): number {
    return this.listeners.size;
  }

  // Get recent logs from buffer
  getRecent(count = 100): LogEntry[] {
    return this.buffer.slice(-count);
  }

  // Log methods
  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };

    // Add to buffer
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    // Notify all listeners
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Ignore listener errors
      }
    }

    // Also log to console based on level
    const prefix = `[${level.toUpperCase()}]`;
    const timestamp = entry.timestamp;
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";

    switch (level) {
      case "debug":
        if (process.env.DEBUG === "1" || process.env.DEBUG === "true") {
          console.log(prefix, timestamp, message, dataStr);
        }
        break;
      case "info":
        console.log(prefix, timestamp, message, dataStr);
        break;
      case "warn":
        console.warn(prefix, timestamp, message, dataStr);
        break;
      case "error":
        console.error(prefix, timestamp, message, dataStr);
        break;
    }
  }

  // Format entry for SSE
  formatForSSE(entry: LogEntry): string {
    return JSON.stringify(entry);
  }
}

// Singleton log stream
export const logStream = new LogStream();

// Helper to check if level should be included
export function shouldIncludeLevel(entryLevel: LogLevel, minLevel: LogLevel): boolean {
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];
  return levels.indexOf(entryLevel) >= levels.indexOf(minLevel);
}
