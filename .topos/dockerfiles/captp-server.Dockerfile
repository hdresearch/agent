# CapTP/OCapN Server Container
# Runs the 26-goblin mesh handshake protocol on port 9323
#
# Build: docker build -t captp-server:latest -f captp-server.Dockerfile .
# Run with cctl: cctl run --id captp-9323 --image captp-server:latest --cpus 2 --memory 512

FROM docker.io/oven/bun:alpine

LABEL maintainer="barton@plurigrid.xyz"
LABEL description="OCapN/CapTP server for 26-goblin mesh with GF(3) conservation"
LABEL version="1.0.0"

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy server files
COPY ocapn-server.ts ./
COPY syrup.ts ./
COPY captp-session.ts ./
COPY syrup-sets.ts ./

# Expose CapTP port
EXPOSE 9323

# Health check - verify server responds
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:9323/ || exit 1

# Run the OCapN server
CMD ["bun", "run", "ocapn-server.ts"]
