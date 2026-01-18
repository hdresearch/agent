#!/bin/bash
# Install vers globally from GitHub releases

set -e

REPO="hdresearch/agent"
RELEASE_TAG="nightly"
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
    else
        echo "vers-agent-${os}-${arch}"
    fi
}

# Get download URL for the asset
get_download_url() {
    local asset_name="$1"
    echo "https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${asset_name}"
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
        curl -fsSL -o "$binary_path" "$download_url"
    elif command -v wget &> /dev/null; then
        wget -q -O "$binary_path" "$download_url"
    else
        echo "Error: curl or wget required"
        exit 1
    fi

    # Make executable
    chmod +x "$binary_path"

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

    echo ""
    echo "Quick start:"
    echo "  vers              # Start HTTP server"
    echo "  vers --help       # Show all options"
    echo ""
}

main "$@"
