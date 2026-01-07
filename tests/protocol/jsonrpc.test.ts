import { test, expect, describe, beforeEach } from "bun:test";
import {
  JSONRPC_VERSION,
  ErrorCode,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcNotification,
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  parseMessage,
  RequestTracker,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
} from "../../src/protocol/jsonrpc";

describe("JSON-RPC Constants", () => {
  test("JSONRPC_VERSION is 2.0", () => {
    expect(JSONRPC_VERSION).toBe("2.0");
  });

  test("ErrorCode has standard codes", () => {
    expect(ErrorCode.ParseError).toBe(-32700);
    expect(ErrorCode.InvalidRequest).toBe(-32600);
    expect(ErrorCode.MethodNotFound).toBe(-32601);
    expect(ErrorCode.InvalidParams).toBe(-32602);
    expect(ErrorCode.InternalError).toBe(-32603);
  });

  test("ErrorCode has ACP-specific codes", () => {
    expect(ErrorCode.AuthRequired).toBe(-32000);
    expect(ErrorCode.AuthFailed).toBe(-32001);
    expect(ErrorCode.SessionNotFound).toBe(-32002);
    expect(ErrorCode.ResourceNotFound).toBe(-32003);
    expect(ErrorCode.OperationCancelled).toBe(-32004);
    expect(ErrorCode.PermissionDenied).toBe(-32005);
  });
});

describe("isJsonRpcRequest", () => {
  test("returns true for valid request with number id", () => {
    const msg = { jsonrpc: "2.0", id: 1, method: "test" };
    expect(isJsonRpcRequest(msg)).toBe(true);
  });

  test("returns true for valid request with string id", () => {
    const msg = { jsonrpc: "2.0", id: "abc-123", method: "test" };
    expect(isJsonRpcRequest(msg)).toBe(true);
  });

  test("returns true for request with params", () => {
    const msg = { jsonrpc: "2.0", id: 1, method: "test", params: { foo: "bar" } };
    expect(isJsonRpcRequest(msg)).toBe(true);
  });

  test("returns false for wrong jsonrpc version", () => {
    const msg = { jsonrpc: "1.0", id: 1, method: "test" };
    expect(isJsonRpcRequest(msg)).toBe(false);
  });

  test("returns false for missing id", () => {
    const msg = { jsonrpc: "2.0", method: "test" };
    expect(isJsonRpcRequest(msg)).toBe(false);
  });

  test("returns false for missing method", () => {
    const msg = { jsonrpc: "2.0", id: 1 };
    expect(isJsonRpcRequest(msg)).toBe(false);
  });

  test("returns false for non-string method", () => {
    const msg = { jsonrpc: "2.0", id: 1, method: 123 };
    expect(isJsonRpcRequest(msg)).toBe(false);
  });

  test("returns false for null", () => {
    expect(isJsonRpcRequest(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isJsonRpcRequest(undefined)).toBe(false);
  });

  test("returns false for primitive types", () => {
    expect(isJsonRpcRequest("string")).toBe(false);
    expect(isJsonRpcRequest(123)).toBe(false);
    expect(isJsonRpcRequest(true)).toBe(false);
  });
});

describe("isJsonRpcResponse", () => {
  test("returns true for success response", () => {
    const msg = { jsonrpc: "2.0", id: 1, result: { data: "test" } };
    expect(isJsonRpcResponse(msg)).toBe(true);
  });

  test("returns true for error response", () => {
    const msg = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid Request" },
    };
    expect(isJsonRpcResponse(msg)).toBe(true);
  });

  test("returns true for null id (parse error)", () => {
    const msg = {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    };
    expect(isJsonRpcResponse(msg)).toBe(true);
  });

  test("returns true for response with null result", () => {
    const msg = { jsonrpc: "2.0", id: 1, result: null };
    expect(isJsonRpcResponse(msg)).toBe(true);
  });

  test("returns false for missing both result and error", () => {
    const msg = { jsonrpc: "2.0", id: 1 };
    expect(isJsonRpcResponse(msg)).toBe(false);
  });

  test("returns false for wrong jsonrpc version", () => {
    const msg = { jsonrpc: "1.0", id: 1, result: "test" };
    expect(isJsonRpcResponse(msg)).toBe(false);
  });

  test("returns false for missing id", () => {
    const msg = { jsonrpc: "2.0", result: "test" };
    expect(isJsonRpcResponse(msg)).toBe(false);
  });
});

describe("isJsonRpcNotification", () => {
  test("returns true for valid notification", () => {
    const msg = { jsonrpc: "2.0", method: "notify" };
    expect(isJsonRpcNotification(msg)).toBe(true);
  });

  test("returns true for notification with params", () => {
    const msg = { jsonrpc: "2.0", method: "notify", params: { event: "update" } };
    expect(isJsonRpcNotification(msg)).toBe(true);
  });

  test("returns false when id is present", () => {
    const msg = { jsonrpc: "2.0", id: 1, method: "test" };
    expect(isJsonRpcNotification(msg)).toBe(false);
  });

  test("returns false for wrong jsonrpc version", () => {
    const msg = { jsonrpc: "1.0", method: "notify" };
    expect(isJsonRpcNotification(msg)).toBe(false);
  });

  test("returns false for missing method", () => {
    const msg = { jsonrpc: "2.0" };
    expect(isJsonRpcNotification(msg)).toBe(false);
  });
});

describe("createRequest", () => {
  test("creates request with number id", () => {
    const req = createRequest(1, "test.method");
    expect(req).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "test.method",
    });
  });

  test("creates request with string id", () => {
    const req = createRequest("uuid-123", "test.method");
    expect(req).toEqual({
      jsonrpc: "2.0",
      id: "uuid-123",
      method: "test.method",
    });
  });

  test("creates request with params", () => {
    const req = createRequest(1, "test.method", { arg1: "value1" });
    expect(req).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "test.method",
      params: { arg1: "value1" },
    });
  });

  test("omits params when undefined", () => {
    const req = createRequest(1, "test.method", undefined);
    expect(req).not.toHaveProperty("params");
  });

  test("includes params when null", () => {
    const req = createRequest(1, "test.method", null);
    expect(req).toHaveProperty("params", null);
  });

  test("result is a valid JsonRpcRequest", () => {
    const req = createRequest(1, "test");
    expect(isJsonRpcRequest(req)).toBe(true);
  });
});

describe("createResponse", () => {
  test("creates success response with object result", () => {
    const res = createResponse(1, { data: "test" });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { data: "test" },
    });
  });

  test("creates success response with null result", () => {
    const res = createResponse(1, null);
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: null,
    });
  });

  test("creates success response with primitive result", () => {
    const res = createResponse(1, "string result");
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: "string result",
    });
  });

  test("result is a valid JsonRpcResponse", () => {
    const res = createResponse(1, { success: true });
    expect(isJsonRpcResponse(res)).toBe(true);
  });
});

describe("createErrorResponse", () => {
  test("creates error response with code and message", () => {
    const res = createErrorResponse(1, ErrorCode.InvalidRequest, "Invalid request");
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: ErrorCode.InvalidRequest,
        message: "Invalid request",
      },
    });
  });

  test("creates error response with data", () => {
    const res = createErrorResponse(1, ErrorCode.InvalidParams, "Missing param", {
      param: "name",
    });
    expect(res).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: ErrorCode.InvalidParams,
        message: "Missing param",
        data: { param: "name" },
      },
    });
  });

  test("creates error response with null id", () => {
    const res = createErrorResponse(null, ErrorCode.ParseError, "Parse error");
    expect(res.id).toBeNull();
  });

  test("omits data when undefined", () => {
    const res = createErrorResponse(1, ErrorCode.InternalError, "Error");
    expect(res.error).not.toHaveProperty("data");
  });

  test("result is a valid JsonRpcResponse", () => {
    const res = createErrorResponse(1, ErrorCode.InternalError, "Error");
    expect(isJsonRpcResponse(res)).toBe(true);
  });
});

describe("createNotification", () => {
  test("creates notification without params", () => {
    const notif = createNotification("event.occurred");
    expect(notif).toEqual({
      jsonrpc: "2.0",
      method: "event.occurred",
    });
  });

  test("creates notification with params", () => {
    const notif = createNotification("event.occurred", { type: "update" });
    expect(notif).toEqual({
      jsonrpc: "2.0",
      method: "event.occurred",
      params: { type: "update" },
    });
  });

  test("omits params when undefined", () => {
    const notif = createNotification("event");
    expect(notif).not.toHaveProperty("params");
  });

  test("result is a valid JsonRpcNotification", () => {
    const notif = createNotification("test");
    expect(isJsonRpcNotification(notif)).toBe(true);
  });
});

describe("parseMessage", () => {
  test("parses valid request", () => {
    const json = '{"jsonrpc":"2.0","id":1,"method":"test"}';
    const msg = parseMessage(json);
    expect(isJsonRpcRequest(msg)).toBe(true);
    expect((msg as JsonRpcRequest).method).toBe("test");
  });

  test("parses valid response", () => {
    const json = '{"jsonrpc":"2.0","id":1,"result":"ok"}';
    const msg = parseMessage(json);
    expect(isJsonRpcResponse(msg)).toBe(true);
    expect((msg as JsonRpcResponse).result).toBe("ok");
  });

  test("parses valid notification", () => {
    const json = '{"jsonrpc":"2.0","method":"notify"}';
    const msg = parseMessage(json);
    expect(isJsonRpcNotification(msg)).toBe(true);
    expect((msg as JsonRpcNotification).method).toBe("notify");
  });

  test("returns null for invalid JSON", () => {
    expect(parseMessage("not json")).toBeNull();
    expect(parseMessage("{invalid}")).toBeNull();
    expect(parseMessage("")).toBeNull();
  });

  test("returns null for valid JSON but invalid message", () => {
    expect(parseMessage('{"foo":"bar"}')).toBeNull();
    expect(parseMessage('{"jsonrpc":"1.0","id":1,"method":"test"}')).toBeNull();
    expect(parseMessage("123")).toBeNull();
    expect(parseMessage('"string"')).toBeNull();
    expect(parseMessage("null")).toBeNull();
  });

  test("parses request with complex params", () => {
    const json = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "test",
      params: {
        nested: { deep: { value: [1, 2, 3] } },
        array: ["a", "b"],
      },
    });
    const msg = parseMessage(json) as JsonRpcRequest;
    expect(msg.params).toEqual({
      nested: { deep: { value: [1, 2, 3] } },
      array: ["a", "b"],
    });
  });
});

describe("RequestTracker", () => {
  let tracker: RequestTracker;

  beforeEach(() => {
    tracker = new RequestTracker(1000); // 1 second timeout for tests
  });

  describe("generateId", () => {
    test("generates sequential ids", () => {
      expect(tracker.generateId()).toBe(1);
      expect(tracker.generateId()).toBe(2);
      expect(tracker.generateId()).toBe(3);
    });

    test("ids are unique across calls", () => {
      const ids = new Set<number>();
      for (let i = 0; i < 100; i++) {
        ids.add(tracker.generateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("track and resolve", () => {
    test("resolves with result on success response", async () => {
      const promise = tracker.track(1);
      const resolved = tracker.resolve(createResponse(1, { data: "test" }));

      expect(resolved).toBe(true);
      await expect(promise).resolves.toEqual({ data: "test" });
    });

    test("rejects with error on error response", async () => {
      const promise = tracker.track(1);
      const resolved = tracker.resolve(
        createErrorResponse(1, ErrorCode.InternalError, "Something went wrong")
      );

      expect(resolved).toBe(true);
      await expect(promise).rejects.toEqual({
        code: ErrorCode.InternalError,
        message: "Something went wrong",
      });
    });

    test("returns false for unknown id", () => {
      tracker.track(1);
      const resolved = tracker.resolve(createResponse(999, "test"));
      expect(resolved).toBe(false);
    });

    test("returns false for null id", () => {
      tracker.track(1);
      const resolved = tracker.resolve(
        createErrorResponse(null, ErrorCode.ParseError, "Parse error")
      );
      expect(resolved).toBe(false);
    });

    test("handles string ids", async () => {
      const promise = tracker.track("abc-123");
      tracker.resolve(createResponse("abc-123", "result"));
      await expect(promise).resolves.toBe("result");
    });

    test("only resolves once", async () => {
      const promise = tracker.track(1);

      const first = tracker.resolve(createResponse(1, "first"));
      const second = tracker.resolve(createResponse(1, "second"));

      expect(first).toBe(true);
      expect(second).toBe(false);
      await expect(promise).resolves.toBe("first");
    });
  });

  describe("timeout", () => {
    test("rejects after timeout", async () => {
      const shortTracker = new RequestTracker(50); // 50ms timeout
      const promise = shortTracker.track(1);

      await expect(promise).rejects.toEqual({
        code: ErrorCode.InternalError,
        message: "Request timeout",
      });
    });

    test("custom timeout per request", async () => {
      const promise = tracker.track(1, 50); // 50ms timeout

      await expect(promise).rejects.toEqual({
        code: ErrorCode.InternalError,
        message: "Request timeout",
      });
    });

    test("does not timeout if resolved in time", async () => {
      const promise = tracker.track(1, 100);

      // Resolve before timeout
      setTimeout(() => {
        tracker.resolve(createResponse(1, "in time"));
      }, 10);

      await expect(promise).resolves.toBe("in time");
    });
  });

  describe("cancelAll", () => {
    test("rejects all pending requests", async () => {
      const p1 = tracker.track(1);
      const p2 = tracker.track(2);
      const p3 = tracker.track(3);

      tracker.cancelAll();

      const expectedError = {
        code: ErrorCode.OperationCancelled,
        message: "Connection closed",
      };

      await expect(p1).rejects.toEqual(expectedError);
      await expect(p2).rejects.toEqual(expectedError);
      await expect(p3).rejects.toEqual(expectedError);
    });

    test("clears pending count", async () => {
      const p1 = tracker.track(1);
      const p2 = tracker.track(2);
      expect(tracker.pendingCount).toBe(2);

      tracker.cancelAll();
      expect(tracker.pendingCount).toBe(0);

      // Consume the rejections to avoid unhandled promise warnings
      await expect(p1).rejects.toBeDefined();
      await expect(p2).rejects.toBeDefined();
    });
  });

  describe("pendingCount", () => {
    test("starts at zero", () => {
      expect(tracker.pendingCount).toBe(0);
    });

    test("increments when tracking", () => {
      tracker.track(1);
      expect(tracker.pendingCount).toBe(1);

      tracker.track(2);
      expect(tracker.pendingCount).toBe(2);
    });

    test("decrements when resolved", () => {
      tracker.track(1);
      tracker.track(2);
      expect(tracker.pendingCount).toBe(2);

      tracker.resolve(createResponse(1, "test"));
      expect(tracker.pendingCount).toBe(1);
    });
  });
});
