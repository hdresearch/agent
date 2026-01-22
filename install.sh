#!/bin/bash
# Install vers globally from GitHub releases

set -e

RELEASE_URL="https://releases.vers.sh/nightly"
INSTALL_DIR="${HOME}/.local/bin"

# Detect OS and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Darwin) os="darwin" ;;
        Linux) os="linux" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
        *) echo "Unsupported OS: $(uname -s)"; exit 1 ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
    esac

    # Windows only has x64 build
    if [ "$os" = "windows" ]; then
        echo "vers-agent-windows-x64.exe"
    # Linux has both x64 and arm64
    elif [ "$os" = "linux" ]; then
        echo "vers-agent-linux-${arch}"
    else
        echo "vers-agent-${os}-${arch}"
    fi
}

# Get download URL for the asset
get_download_url() {
    local asset_name="$1"
    echo "${RELEASE_URL}/${asset_name}"
}

main() {
    echo "Installing vers..."

    # Detect platform
    local asset_name
    asset_name=$(detect_platform)
    echo "Detected platform: ${asset_name}"

    # Create install directory
    mkdir -p "$INSTALL_DIR"

    # Download binary
    local download_url binary_path
    download_url=$(get_download_url "$asset_name")

    if [ "$(uname -s)" = "MINGW"* ] || [ "$(uname -s)" = "MSYS"* ]; then
        binary_path="${INSTALL_DIR}/vers.exe"
    else
        binary_path="${INSTALL_DIR}/vers"
    fi

    echo "Downloading from: ${download_url}"

    if command -v curl &> /dev/null; then
        curl -fL# -o "$binary_path" "$download_url"
    elif command -v wget &> /dev/null; then
        wget --progress=bar:force -O "$binary_path" "$download_url" 2>&1
    else
        echo "Error: curl or wget required"
        exit 1
    fi

    # Make executable
    chmod +x "$binary_path"

    # macOS: remove quarantine and ad-hoc sign (Gatekeeper blocks unsigned binaries)
    if [ "$(uname -s)" = "Darwin" ]; then
        xattr -d com.apple.quarantine "$binary_path" 2>/dev/null || true
        codesign --force --sign - "$binary_path" 2>/dev/null || true
    fi

    echo ""
    echo "Installed vers to: ${binary_path}"
    echo ""

    # Check if install dir is in PATH
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        echo "Add to your shell profile:"
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo ""
    fi

    # Install bundled skills
    echo "Installing skills..."
    "$binary_path" --install-skills

    # Configure MCP for Claude Desktop and Claude Code
    echo ""
    echo "Configuring MCP server..."
    "$binary_path" --mcp-install

    echo ""
    echo "Quick start:"
    echo "  vers              # Start HTTP server"
    echo "  vers --mcp        # Run as MCP server"
    echo "  vers --help       # Show all options"
    echo ""
}

main "$@"
