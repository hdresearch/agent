#!/bin/bash
# Install vers-agent globally

set -e

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is required but not installed."
    echo "Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing vers-agent..."

# Install dependencies
cd "$SCRIPT_DIR"
bun install

# Build the bundle
bun run build:bundle

# Create symlink in bun's bin directory
BUN_BIN="${HOME}/.bun/bin"
mkdir -p "$BUN_BIN"

# Remove old symlink if exists
rm -f "$BUN_BIN/vers"

# Create new symlink
ln -s "$SCRIPT_DIR/bin/vers.js" "$BUN_BIN/vers"

echo ""
echo "Installed! You can now run 'vers' from anywhere."
echo ""
echo "Make sure ~/.bun/bin is in your PATH:"
echo '  export PATH="$HOME/.bun/bin:$PATH"'
echo ""
echo "Quick start:"
echo "  vers              # Start server + CLI"
echo "  vers --server     # Server only (daemon mode)"
echo "  vers --help       # Show all options"
