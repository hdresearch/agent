// Synchronization primitives for test utilities
// Replaces magic timing delays with proper async patterns

/**
 * Get the appropriate test timeout based on environment
 * CI environments are slower and need longer timeouts
 */
export function getTestTimeout(baseTimeout: number = 5000): number {
  return process.env.CI ? baseTimeout * 2 : baseTimeout;
}

/** Default test timeout - use this for most waitUntil calls */
export const TEST_TIMEOUT = getTestTimeout(5000);

/**
 * Deferred promise for event-driven synchronization
 * Useful when you need to resolve a promise from outside its executor
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Wait until a condition becomes true with proper polling
 * Replaces arbitrary setTimeout delays
 */
export interface WaitUntilOptions {
  /** Maximum time to wait in ms (default: 5000) */
  timeout?: number;
  /** Polling interval in ms (default: 10) */
  interval?: number;
  /** Error message on timeout */
  message?: string;
}

export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  options: WaitUntilOptions = {}
): Promise<void> {
  const { timeout = TEST_TIMEOUT, interval = 10, message } = options;
  const start = Date.now();

  while (true) {
    const result = await condition();
    if (result) return;

    if (Date.now() - start > timeout) {
      throw new Error(
        message || `waitUntil timed out after ${timeout}ms`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Wrap a promise with a timeout
 * Useful for operations that might hang
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  message?: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(message || `Operation timed out after ${timeout}ms`));
    }, timeout);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Flush all pending microtasks and scheduled callbacks
 * More reliable than arbitrary delays for React/Ink state updates
 *
 * This works by:
 * 1. Yielding to microtask queue (queueMicrotask)
 * 2. Yielding to timer queue (setTimeout 0)
 * 3. Repeating for specified iterations to catch cascading updates
 */
export async function flushAsync(iterations: number = 3): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    // Flush microtasks
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    // Flush timer queue
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Wait for an event emitter to emit a specific event
 * Returns the event data
 */
export async function waitForEvent<T>(
  emitter: { on: (event: string, handler: (data: T) => void) => void; off?: (event: string, handler: (data: T) => void) => void },
  event: string,
  timeout: number = TEST_TIMEOUT
): Promise<T> {
  return withTimeout(
    new Promise<T>((resolve) => {
      const handler = (data: T) => {
        emitter.off?.(event, handler);
        resolve(data);
      };
      emitter.on(event, handler);
    }),
    timeout,
    `Event '${event}' not emitted within ${timeout}ms`
  );
}

/**
 * Wait for multiple events from an emitter
 * Returns array of event data in order received
 */
export async function waitForEvents<T>(
  emitter: { on: (event: string, handler: (data: T) => void) => void; off?: (event: string, handler: (data: T) => void) => void },
  event: string,
  count: number = 1,
  timeout: number = TEST_TIMEOUT
): Promise<T[]> {
  const results: T[] = [];
  const deferred = createDeferred<T[]>();

  const handler = (data: T) => {
    results.push(data);
    if (results.length >= count) {
      emitter.off?.(event, handler);
      deferred.resolve(results);
    }
  };

  emitter.on(event, handler);

  return withTimeout(
    deferred.promise,
    timeout,
    `Expected ${count} '${event}' events, got ${results.length} within ${timeout}ms`
  );
}

/**
 * Retry an async operation with exponential backoff
 * Useful for operations that might fail transiently
 */
export interface RetryOptions {
  /** Maximum number of retries (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 100) */
  initialDelay?: number;
  /** Maximum delay in ms (default: 5000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2) */
  backoff?: number;
  /** Function to determine if error is retryable (default: all errors) */
  isRetryable?: (error: Error) => boolean;
}

export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 5000,
    backoff = 2,
    isRetryable = () => true,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt >= maxRetries || !isRetryable(lastError)) {
        throw lastError;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoff, maxDelay);
    }
  }

  throw lastError;
}
