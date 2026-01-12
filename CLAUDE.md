# vers-agent Development Guide

## Architecture Overview

vers-agent is an ACP (Agent Client Protocol) compliant harness that can:
1. Run as a local server + CLI
2. Connect to remote servers (e.g., on Vers VMs)
3. Orchestrate multiple VMs via the vers-sdk

```
┌─────────────────────────────────────────────────────────────────────┐
│                           vers-agent                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐  │
│  │    CLI      │────▶│   HTTP Client    │────▶│  Remote Server  │  │
│  │  (Ink/React)│     │  (http-client.ts)│     │  or localhost   │  │
│  └─────────────┘     └──────────────────┘     └─────────────────┘  │
│                              │                        │             │
│                              │ JSON-RPC               │             │
│                              │ + SSE                  │             │
│                              ▼                        ▼             │
│  ┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐  │
│  │  Handlers   │────▶│   HTTP Server    │────▶│  Agent Runner   │  │
│  │  (server/)  │     │  (http-server.ts)│     │  (subprocess)   │  │
│  └─────────────┘     └──────────────────┘     └─────────────────┘  │
│                                                       │             │
│                                                       ▼             │
│                                               ┌─────────────────┐  │
│                                               │  Claude Code    │  │
│                                               │  (or other ACP  │  │
│                                               │   agents)       │  │
│                                               └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Directories

```
src/
├── cli/           # Terminal UI (React/Ink)
│   ├── app.tsx              # Main component
│   ├── handlers/            # Command handlers (/new, /model, etc)
│   └── hooks/               # useAcpClient, etc
├── client/        # HTTP client for connecting to servers
│   └── http-client.ts       # JSON-RPC + SSE client
├── server/        # HTTP server implementation
│   ├── http-server.ts       # Main server, RPC router
│   ├── sse-manager.ts       # SSE client management
│   └── handlers/            # RPC method handlers
├── agents/        # Agent subprocess management
│   ├── agent-runner.ts      # Spawns and manages agent process
│   ├── acp-client.ts        # Talks to agent via stdin/stdout
│   ├── registry.ts          # Discovers agents from JSON files
│   └── event-mapper.ts      # Maps ACP events to PromptEvents
├── core/          # Business logic
│   ├── agent-manager.ts     # High-level agent control
│   ├── tasks.ts             # Task state machine
│   └── prompt-queue.ts      # Queue for prompts
├── protocol/      # Type definitions
│   ├── acp-types.ts         # All ACP types (500+ lines)
│   └── jsonrpc.ts           # JSON-RPC 2.0 types
├── vm/            # Vers VM integration
│   ├── index.ts             # createVm, branch, commit, etc
│   └── bootstrap.ts         # Install Node/Claude on VM
├── orchestrator/  # Multi-VM orchestration
│   └── index.ts             # Managed VMs, parallel execution
└── utils/         # Shared utilities
    ├── config.ts            # ~/.vers-agent/config.json
    ├── session-store.ts     # SQLite for sessions
    └── log-stream.ts        # Rotating file logger
```

### Request Flow

1. User types in CLI → `handleSlashCommand()` or `handleSessionPrompt()`
2. HTTP client sends JSON-RPC to server
3. Server routes to handler in `http-server.ts`
4. Handler may invoke agent via `AgentRunner`
5. Agent events stream back via SSE
6. CLI displays via React components

### Data Storage

All persisted data in `~/.vers-agent/`:
- `sessions.db` - SQLite (sessions, outputs)
- `config.json` - User preferences
- `tokens.json` - Auth tokens
- `logs/` - Rotating logs
- `orchestrator/` - VM metadata (JSON)
- `skills/` - Local skill definitions (JSON)

---

## Bun Conventions

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.

## vers-agent Build Commands

Use the npm scripts defined in package.json:

- `bun run build` - Compile to standalone executable `./vers-agent`
- `bun run build:bundle` - Bundle to `dist/index.js`
- `bun run start` - Run from source
- `bun run dev` - Run with hot reload

## Logging

vers-agent uses a rotating file logger that writes to `~/.vers-agent/logs/vers-agent.log`.

- **Log files**: Rotates at 5MB with up to 5 backup files
- **Debug output**: Set `VERS_DEBUG=true` or `VERS_DEBUG=1` to print debug messages to the console
- Debug logs are always written to the log file, regardless of `VERS_DEBUG` setting
- Use `logStream.debug()` for debug messages instead of `console.log()`

Example:
```bash
VERS_DEBUG=true ./vers-agent --local
```
