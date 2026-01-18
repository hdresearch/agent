#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# build-chelsea-image.sh (FAST)
# Builds chelsea-compatible vers-agent image using ONLY flox containerize
# Usage: ./build-chelsea-image.sh [image-name] [--no-cache]
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

IMAGE_NAME="${1:-vers-agent:chelsea}"
NO_CACHE="${2:-}"
TAR_FILE="chelsea-fleet.tar"
BASE_IMAGE_TAG="vers-base:flox"

ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) PLATFORM="${PLATFORM:-linux/arm64}" ;;
  *)             PLATFORM="${PLATFORM:-linux/amd64}" ;;
esac

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_STAGING="${TMPDIR:-/tmp}/vers-chelsea-staging"

cd "$PROJECT_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Building chelsea vers-agent image (FAST)"
echo "  Target: $PLATFORM"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Step 1: Build application (skip if fresh) ─────────────────────
if [ -f dist/index.js ] && [ dist/index.js -nt index.ts ] && [ -z "$NO_CACHE" ]; then
  echo "[1/4] Skipping build (dist/index.js is fresh)"
else
  echo "[1/4] Building application..."
  bun install --frozen-lockfile 2>/dev/null || bun install
  bun run build:bundle
fi

# ─── Step 2: Stage app files (minimal - no node_modules) ───────────
echo "[2/4] Staging application files..."
rm -rf "$APP_STAGING" 2>/dev/null || true
mkdir -p "$APP_STAGING/app"

cp -r dist "$APP_STAGING/app/"
cp package.json "$APP_STAGING/app/"
[ -f scripts/fleet-entrypoint.sh ] && cp scripts/fleet-entrypoint.sh "$APP_STAGING/app/" && chmod +x "$APP_STAGING/app/fleet-entrypoint.sh"
[ -f src/tunnel/policy.yml ] && mkdir -p "$APP_STAGING/app/config" && cp src/tunnel/policy.yml "$APP_STAGING/app/config/"

echo "   Staged $(du -sh "$APP_STAGING/app" | cut -f1) to $APP_STAGING/app"

# ─── Step 3: Flox containerize (cache base image) ──────────────────
MANIFEST_HASH=$(openssl dgst -sha3-256 .flox/env/manifest.toml 2>/dev/null | awk '{print $2}' || shasum -a 256 .flox/env/manifest.toml | cut -d' ' -f1)
CACHED_BASE=$(docker images -q "$BASE_IMAGE_TAG" 2>/dev/null || true)

if [ -n "$CACHED_BASE" ] && [ -z "$NO_CACHE" ]; then
  echo "[3/4] Using cached base image $BASE_IMAGE_TAG"
  BASE_IMAGE="$BASE_IMAGE_TAG"
else
  echo "[3/4] Running flox containerize..."
  flox containerize -f "$TAR_FILE"
  docker load < "$TAR_FILE"
  BASE_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "^(agent|flox)" | head -1)
  docker tag "$BASE_IMAGE" "$BASE_IMAGE_TAG"
  echo "   Cached as $BASE_IMAGE_TAG"
fi

# ─── Step 4: Add app layer (no Dockerfile file, heredoc only) ───────
echo "[4/4] Injecting app layer..."

docker build --platform "$PLATFORM" -t "$IMAGE_NAME" --build-arg BASE_IMAGE="$BASE_IMAGE" -f - "$APP_STAGING" << 'DOCKERFILE'
ARG BASE_IMAGE=agent:latest
FROM ${BASE_IMAGE}

COPY app/ /app/

ENV PORT=9999 \
    NODE_ENV=production \
    VERS_AGENT_HOME=/tmp/.vers-agent \
    VERS_VM_ID=alpha \
    VERS_VM_NAME=crimson \
    VERS_VM_TRIT=-1 \
    VERS_VM_COLOR=#DC143C

WORKDIR /app
EXPOSE 9999

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:${PORT}/health || exit 1

# flox container already has /activate as ENTRYPOINT, just provide the command
CMD ["-c", "exec bun run /app/dist/index.js --server"]
DOCKERFILE

# ─── Done ───────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ $IMAGE_NAME"
docker images "$IMAGE_NAME" --format "  Size: {{.Size}}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Test: docker run --rm -p 9999:9999 -e ANTHROPIC_API_KEY=\$ANTHROPIC_API_KEY $IMAGE_NAME"
