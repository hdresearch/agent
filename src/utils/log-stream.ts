// Log streaming with rotating file output
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync, statSync, renameSync, readdirSync, unlinkSync, appendFileSync } from "fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

type LogListener = (entry: LogEntry) => void;

// Rotating file writer
class RotatingFileWriter {
  private logDir: string;
  private currentFile: string;
  private maxFileSize: number;
  private maxFiles: number;
  private writeBuffer: string[] = [];
  private flushTimer: Timer | null = null;

  constructor(
    logDir: string,
    options: { maxFileSize?: number; maxFiles?: number } = {}
  ) {
    this.logDir = logDir;
    this.maxFileSize = options.maxFileSize ?? 5 * 1024 * 1024; // 5MB default
    this.maxFiles = options.maxFiles ?? 5;
    this.currentFile = join(logDir, "vers-agent.log");

    // Ensure log directory exists
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  async write(line: string): Promise<void> {
    this.writeBuffer.push(line);

    // Debounce writes for performance
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 100);
    }
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.writeBuffer.length === 0) return;

    const lines = this.writeBuffer.join("\n") + "\n";
    this.writeBuffer = [];

    try {
      // Check if rotation is needed
      await this.rotateIfNeeded();

      // Append to current log file
      appendFileSync(this.currentFile, lines);
    } catch (err) {
      // Fallback to console if file write fails
      console.error("[LOG] Failed to write to log file:", err);
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      if (!existsSync(this.currentFile)) return;

      const stats = statSync(this.currentFile);
      if (stats.size < this.maxFileSize) return;

      // Rotate files
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldFile = join(this.logDir, `vers-agent.${i}.log`);
        const newFile = join(this.logDir, `vers-agent.${i + 1}.log`);
        if (existsSync(oldFile)) {
          if (i === this.maxFiles - 1) {
            unlinkSync(oldFile); // Delete oldest
          } else {
            renameSync(oldFile, newFile);
          }
        }
      }

      // Rotate current to .1
      renameSync(this.currentFile, join(this.logDir, "vers-agent.1.log"));
    } catch {
      // Ignore rotation errors
    }
  }

  // Force flush on shutdown
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

class LogStream {
  private listeners: Set<LogListener> = new Set();
  private buffer: LogEntry[] = [];
  private maxBufferSize = 1000;
  private fileWriter: RotatingFileWriter | null = null;
  private consoleEnabled: boolean;

  constructor() {
    // Only enable console logging if not in production or DEBUG is set
    this.consoleEnabled =
      process.env.NODE_ENV !== "production" ||
      process.env.LOG_TO_CONSOLE === "1";

    // Initialize file writer
    const logDir = join(homedir(), ".vers-agent", "logs");
    this.fileWriter = new RotatingFileWriter(logDir, {
      maxFileSize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    });
  }

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

    // Format log line
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    const logLine = `[${level.toUpperCase()}] ${entry.timestamp} ${message}${dataStr}`;

    // Write to rotating file
    if (this.fileWriter) {
      this.fileWriter.write(logLine);
    }

    // Only log errors and warnings to console in production
    // Debug/info only if explicitly enabled
    if (this.consoleEnabled) {
      switch (level) {
        case "debug":
          if (process.env.DEBUG === "1" || process.env.DEBUG === "true") {
            console.log(logLine);
          }
          break;
        case "info":
          // Skip info in production unless LOG_TO_CONSOLE is set
          if (process.env.NODE_ENV !== "production" || process.env.LOG_TO_CONSOLE === "1") {
            console.log(logLine);
          }
          break;
        case "warn":
          console.warn(logLine);
          break;
        case "error":
          console.error(logLine);
          break;
      }
    } else {
      // In production, only log errors to console
      if (level === "error") {
        console.error(logLine);
      }
    }
  }

  // Format entry for SSE
  formatForSSE(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  // Graceful shutdown
  async close(): Promise<void> {
    if (this.fileWriter) {
      await this.fileWriter.close();
    }
  }
}

// Singleton log stream
export const logStream = new LogStream();

// Helper to check if level should be included
export function shouldIncludeLevel(entryLevel: LogLevel, minLevel: LogLevel): boolean {
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];
  return levels.indexOf(entryLevel) >= levels.indexOf(minLevel);
}

// Handle process exit to flush logs
process.on("beforeExit", async () => {
  await logStream.close();
});
