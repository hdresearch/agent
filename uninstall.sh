#!/bin/bash
# Uninstall vers-agent

set -e

BUN_BIN="${HOME}/.bun/bin"

if [ -L "$BUN_BIN/vers" ]; then
    rm "$BUN_BIN/vers"
    echo "Removed vers from $BUN_BIN"
else
    echo "vers is not installed in $BUN_BIN"
fi

echo ""
echo "Uninstalled. You can also remove the source directory if desired."
