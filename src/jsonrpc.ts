// JSON-RPC 2.0 message types for ACP protocol

export const JSONRPC_VERSION = "2.0" as const;

// Base message types
export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number | string | null;  // null when id cannot be determined (parse errors)
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // ACP-specific error codes (-32000 to -32099)
  AuthRequired: -32000,
  AuthFailed: -32001,
  SessionNotFound: -32002,
  ResourceNotFound: -32003,
  OperationCancelled: -32004,
  PermissionDenied: -32005,
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// Type guards
export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "jsonrpc" in msg &&
    msg.jsonrpc === JSONRPC_VERSION &&
    "id" in msg &&
    "method" in msg &&
    typeof (msg as JsonRpcRequest).method === "string"
  );
}

export function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "jsonrpc" in msg &&
    msg.jsonrpc === JSONRPC_VERSION &&
    "id" in msg &&
    ("result" in msg || "error" in msg)
  );
}

export function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "jsonrpc" in msg &&
    msg.jsonrpc === JSONRPC_VERSION &&
    "method" in msg &&
    !("id" in msg)
  );
}

// Helper to create messages
export function createRequest(
  id: number | string,
  method: string,
  params?: unknown
): JsonRpcRequest {
  const req: JsonRpcRequest = { jsonrpc: JSONRPC_VERSION, id, method };
  if (params !== undefined) {
    req.params = params;
  }
  return req;
}

export function createResponse(
  id: number | string,
  result: unknown
): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function createErrorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

export function createNotification(
  method: string,
  params?: unknown
): JsonRpcNotification {
  const notif: JsonRpcNotification = { jsonrpc: JSONRPC_VERSION, method };
  if (params !== undefined) {
    notif.params = params;
  }
  return notif;
}

// Parse a JSON-RPC message from string
export function parseMessage(
  data: string
): JsonRpcRequest | JsonRpcResponse | JsonRpcNotification | null {
  try {
    const parsed = JSON.parse(data);
    if (isJsonRpcRequest(parsed)) return parsed;
    if (isJsonRpcResponse(parsed)) return parsed;
    if (isJsonRpcNotification(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

// Request/response correlation
export class RequestTracker {
  private pendingRequests = new Map<
    number | string,
    {
      resolve: (result: unknown) => void;
      reject: (error: JsonRpcError) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 1;
  private defaultTimeout: number;

  constructor(defaultTimeout = 30000) {
    this.defaultTimeout = defaultTimeout;
  }

  generateId(): number {
    return this.nextId++;
  }

  track(
    id: number | string,
    timeout?: number
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutMs = timeout ?? this.defaultTimeout;
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject({ code: ErrorCode.InternalError, message: "Request timeout" });
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });
    });
  }

  resolve(response: JsonRpcResponse): boolean {
    // Null id means parse error - can't match to a pending request
    if (response.id === null) return false;

    const pending = this.pendingRequests.get(response.id);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(response.error);
    } else {
      pending.resolve(response.result);
    }
    return true;
  }

  cancelAll(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject({
        code: ErrorCode.OperationCancelled,
        message: "Connection closed",
      });
    }
    this.pendingRequests.clear();
  }

  get pendingCount(): number {
    return this.pendingRequests.size;
  }
}
