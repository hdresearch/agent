# syntax=docker/dockerfile:1
# Lean vers-agent deployment image
# ~165MB total vs ~800MB+ current Dockerfile

FROM alpine:3.19 AS base
WORKDIR /app

# Minimal system dependencies
RUN apk add --no-cache \
    curl \
    sqlite-libs \
    ca-certificates

# Install Bun runtime
FROM base AS bun
RUN curl -fsSL https://bun.sh/install | sh
ENV PATH="/root/.bun/bin:$PATH"

# Build stage - bundle application
FROM bun AS build
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN bun run build:bundle

# Production stage - minimal runtime
FROM bun AS production
WORKDIR /app

# Copy built artifacts
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/src/tunnel/policy.yml ./src/tunnel/policy.yml

# Install Claude Code standalone binary
RUN curl -fsSL https://storage.googleapis.com/anthropic-releases/claude-code/latest/claude-code-linux-x64 \
    -o /usr/local/bin/claude-code \
    && chmod +x /usr/local/bin/claude-code

# Install ngrok standalone binary
RUN curl -fsSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
    | tar xz -C /usr/local/bin

# Create non-root user
RUN adduser -D -s /bin/sh vers \
    && mkdir -p /home/vers/.vers-agent/logs \
    && mkdir -p /home/vers/.claude \
    && chown -R vers:vers /home/vers /app

# Switch to non-root user
USER vers

# Environment setup
ENV HOME=/home/vers
ENV CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude-code
ENV PORT=9999
ENV NODE_ENV=production
ENV VERS_AGENT_HOME=/home/vers/.vers-agent

# Expose ACP server port
EXPOSE 9999

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:9999/health || exit 1

# Startup script to launch both ngrok and vers-agent
COPY --chown=vers:vers <<'EOF' /home/vers/entrypoint.sh
#!/bin/sh
set -e

# Source environment from ~/.topos/.env if it exists (mounted volume)
if [ -f "$HOME/.topos/.env" ]; then
  echo "Loading environment from ~/.topos/.env"
  export $(grep -v '^#' "$HOME/.topos/.env" | xargs)
fi

# Start ngrok in background if authtoken is available
if [ -n "$NGROK_AUTHTOKEN" ]; then
  echo "Starting ngrok tunnel on port $PORT..."
  ngrok http "$PORT" \
    --authtoken "$NGROK_AUTHTOKEN" \
    --traffic-policy-file /app/src/tunnel/policy.yml \
    --log stdout \
    --log-level info &
  
  # Wait for ngrok to establish tunnel
  sleep 3
  
  # Get and log tunnel URL
  if command -v curl >/dev/null 2>&1; then
    TUNNEL_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -o 'https://[^"]*\.ngrok[^"]*' | head -1 || echo "")
    if [ -n "$TUNNEL_URL" ]; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "✓ ngrok tunnel active: $TUNNEL_URL"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
  fi
else
  echo "Warning: NGROK_AUTHTOKEN not set, skipping tunnel"
fi

# Start vers-agent server
echo "Starting vers-agent server on port $PORT..."
exec bun run /app/dist/index.js --server
EOF

RUN chmod +x /home/vers/entrypoint.sh

CMD ["/home/vers/entrypoint.sh"]
