# Testing Plan: Session ID Fix (Issue #38)

## Problem Summary

`sessionManager.currentId` was not being set when `getAgentSessionId()` provided the session ID, causing session outputs to not be stored.

**Root Cause:** In `handleSessionNew`, `setSession()` was only called when `claudeId` was truthy:
```typescript
// BEFORE (buggy)
const newSessionId = claudeId || getAgentSessionId() || sessionManager.createSession();
if (claudeId) {
  sessionManager.setSession(claudeId);  // Only called when claudeId exists!
}
```

**Fix:** Always call `setSession()` with the resolved session ID:
```typescript
// AFTER (fixed)
const newSessionId = claudeId || getAgentSessionId() || sessionManager.createSession();
sessionManager.setSession(newSessionId);  // Always called
```

---

## Test Scenarios

### 1. Unit Tests

#### 1.1 SessionManager.setSession() idempotency
```typescript
// File: tests/core/session-manager.test.ts
test("setSession is idempotent - calling twice with same ID is safe", () => {
  const manager = new SessionManager();
  manager.setSession("test-123");
  manager.setSession("test-123"); // Should not throw
  expect(manager.getCurrentId()).toBe("test-123");
});
```

#### 1.2 handleSessionNew sets currentId via getAgentSessionId path
```typescript
// File: tests/server/handlers/session.test.ts
test("handleSessionNew sets currentId when getAgentSessionId provides ID", async () => {
  // Mock: claudeId = null, getAgentSessionId = "agent-session-123"
  // Assert: sessionManager.getCurrentId() === "agent-session-123"
});
```

#### 1.3 handleSessionNew sets currentId via claudeId path
```typescript
test("handleSessionNew sets currentId when claudeId is captured", async () => {
  // Mock: claudeId = "claude-456"
  // Assert: sessionManager.getCurrentId() === "claude-456"
});
```

#### 1.4 handleSessionNew sets currentId via createSession path
```typescript
test("handleSessionNew sets currentId via createSession when no other ID available", async () => {
  // Mock: claudeId = null, getAgentSessionId = null
  // Assert: sessionManager.getCurrentId() is a valid UUID
});
```

---

### 2. Integration Tests

#### 2.1 Fresh server start - outputs are stored
```typescript
// File: tests/integration/session-outputs.test.ts
test("fresh server stores session outputs correctly", async () => {
  // 1. Start fresh server
  // 2. POST session/new
  // 3. POST session/prompt with "test message"
  // 4. Wait for response
  // 5. GET session/outputs
  // Assert: outputs array contains user message and assistant response
});
```

#### 2.2 Multiple prompts in same session
```typescript
test("multiple prompts in same session all have outputs stored", async () => {
  // 1. POST session/new
  // 2. POST session/prompt "first"
  // 3. Wait for response
  // 4. POST session/prompt "second"
  // 5. Wait for response
  // 6. GET session/outputs
  // Assert: outputs contains all 4 messages (2 user + 2 assistant)
});
```

#### 2.3 New session after existing session (subprocess reuse)
```typescript
test("new session after existing session stores outputs correctly", async () => {
  // 1. POST session/new → session A
  // 2. POST session/prompt "hello"
  // 3. Wait for response
  // 4. POST session/new → session B (subprocess reused)
  // 5. POST session/prompt "world"
  // 6. Wait for response
  // 7. GET session/outputs for session B
  // Assert: session B outputs contain "world" message and response
});
```

---

### 3. Manual Testing Checklist

#### 3.1 Local Server Testing
```bash
# Terminal 1: Start server
./vers-agent --local

# Terminal 2: Test via curl
# Create session
curl -X POST http://localhost:9999/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"session/new","params":{}}'
# Expected: {"result":{"sessionId":"<uuid>","mode":"default"}}

# Send prompt
curl -X POST http://localhost:9999/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"text":"Say hello"}}'
# Expected: {"result":{"success":true}}

# Wait 5-10 seconds, then check outputs
curl -X POST http://localhost:9999/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"session/outputs","params":{}}'
# Expected: {"result":{"sessionId":"<uuid>","outputs":[...],"syncInfo":{...}}}

# Verify outputs array is NOT empty
```

#### 3.2 VM Testing
```bash
# 1. Restore VM from golden image
# 2. Upload fixed binary
# 3. Start vers-agent server
# 4. Run same curl commands as above
# 5. Verify outputs are stored
```

#### 3.3 Subprocess Reuse Testing
```bash
# 1. Start server
# 2. Create session A, send prompt, verify outputs stored
# 3. Create session B (without restarting server)
# 4. Send prompt to session B
# 5. Verify session B outputs are stored (this was the bug!)
```

---

### 4. Edge Cases

#### 4.1 Rapid session creation
```typescript
test("rapid session/new calls don't corrupt session state", async () => {
  // Create 5 sessions rapidly without waiting
  // Each should have a valid, unique sessionId
});
```

#### 4.2 Session resume
```typescript
test("session resume maintains output storage", async () => {
  // 1. Create session, send prompt
  // 2. Note session ID
  // 3. Restart server with --resume
  // 4. Send another prompt
  // 5. Verify all outputs (old + new) are accessible
});
```

#### 4.3 Concurrent prompts
```typescript
test("concurrent prompts to same session store all outputs", async () => {
  // 1. Create session
  // 2. Send 3 prompts simultaneously
  // 3. Wait for all responses
  // 4. Verify all 6 messages stored (3 user + 3 assistant)
});
```

---

### 5. Regression Tests

#### 5.1 Verify OUTPUT_STORE logs don't show null sessionId
```bash
# Run server with debug logging
VERS_DEBUG=true ./vers-agent --local

# Send prompts and check logs
grep "OUTPUT_STORE" ~/.vers-agent/logs/vers-agent.log

# Should NOT see: "No currentSessionId, skipping storage"
# Should see: sessionId with valid UUID
```

#### 5.2 SQLite session store verification
```bash
# After sending prompts, check SQLite directly
sqlite3 ~/.vers-agent/sessions.db "SELECT id, type, content FROM session_outputs LIMIT 10;"

# Should see rows with valid session_id, type, and content
```

---

## Test Execution Commands

```bash
# Run all unit tests
bun test

# Run specific session tests
bun test tests/server/handlers/session.test.ts

# Run integration tests (requires server)
bun test tests/integration/

# Run with coverage
bun test --coverage
```

---

## Success Criteria

1. All existing tests pass (593 tests)
2. New session ID tests pass
3. Manual testing confirms outputs are stored
4. VM testing confirms fix works in production-like environment
5. No `"No currentSessionId, skipping storage"` warnings in logs during normal operation
