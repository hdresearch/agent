# syntax=docker/dockerfile:1
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Build stage
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build:bundle

# Production stage
FROM base AS production
WORKDIR /app

# Install Node.js, Claude Code, the Zed ACP adapter, and expect (for PTY testing)
RUN apt-get update && apt-get install -y curl expect \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @anthropic-ai/claude-code @zed-industries/claude-code-acp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash agent \
    && mkdir -p /home/agent/.claude /home/agent/.vers-agent \
    && chown -R agent:agent /home/agent

# Copy built files and dependencies
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Give agent user ownership of app directory
RUN chown -R agent:agent /app

# Switch to non-root user
USER agent

# Set environment variables
ENV PORT=9999
ENV NODE_ENV=production
ENV HOME=/home/agent
# Claude Code is installed globally via npm
ENV CLAUDE_CODE_EXECUTABLE=/usr/bin/claude

# Expose the ACP server port
EXPOSE 9999

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:9999/rpc -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"session/status","id":1}' || exit 1

# Run the server in server-only mode
CMD ["bun", "run", "dist/index.js", "--server"]
