{
  description = "vers-agent - ACP-compliant AI agent harness with interactive CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        # Fixed-output derivation for node_modules
        # Update this hash when bun.lock changes: just nix-hash
        node_modules = pkgs.stdenv.mkDerivation {
          pname = "vers-agent-node_modules";
          version = "0.1.0";

          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              let name = baseNameOf path; in
              name == "package.json" || name == "bun.lock";
          };

          nativeBuildInputs = [ pkgs.bun pkgs.cacert ];

          # FOD settings
          outputHashMode = "recursive";
          outputHashAlgo = "sha256";
          # To get the initial hash, run: just nix-hash
          # Or set to empty string "" and nix will tell you the correct hash
          outputHash = "sha256-fX0DE+dpSFej/ikAiR+XHoQFlZAxzt0/pkjx3B7Y864=";

          SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
          HOME = "/tmp/bun-home";

          buildPhase = ''
            runHook preBuild
            mkdir -p $HOME
            bun install --frozen-lockfile
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r node_modules $out/
            runHook postInstall
          '';
        };

        # Build the vers-agent package
        vers-agent = pkgs.stdenv.mkDerivation {
          pname = "vers-agent";
          version = "0.1.0";

          src = pkgs.lib.cleanSource ./.;

          nativeBuildInputs = with pkgs; [
            bun
            nodejs_22
            makeWrapper
          ];

          HOME = "/tmp/bun-build-home";

          buildPhase = ''
            runHook preBuild

            mkdir -p $HOME

            # Use pre-fetched node_modules
            cp -r ${node_modules}/node_modules .
            chmod -R u+w node_modules

            # Bundle to JS (bun compile doesn't work in Nix sandbox)
            bun build --target=bun --minify ./index.ts --outdir=dist

            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p $out/lib/vers-agent $out/bin

            # Copy bundled JS
            cp dist/index.js $out/lib/vers-agent/

            # Create wrapper script that uses bun
            makeWrapper ${pkgs.bun}/bin/bun $out/bin/vers-agent \
              --add-flags "$out/lib/vers-agent/index.js"

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "ACP-compliant AI agent harness with interactive CLI";
            homepage = "https://github.com/hdresearch/vers-agent";
            license = licenses.mit;
            maintainers = [ ];
            platforms = platforms.unix;
          };
        };

      in
      {
        packages = {
          default = vers-agent;
          vers-agent = vers-agent;
          node_modules = node_modules;
        };

        # Development shell with all tools needed
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Runtime
            bun
            nodejs_22

            # Build tools
            just
            typescript

            # Nix tools
            nix-prefetch

            # Utilities
            jq
            curl
          ];

          shellHook = ''
            echo "vers-agent development environment"
            echo ""
            echo "Available commands:"
            echo "  just install    - Install dependencies and git hooks"
            echo "  just dev        - Run with hot reload"
            echo "  just build      - Build standalone executable"
            echo "  just test       - Run tests"
            echo "  just check      - Run typecheck and tests"
            echo "  just nix-hash   - Update flake.nix node_modules hash"
            echo ""

            # Set up git hooks if in a git repo
            if [ -d .git ]; then
              just setup-hooks 2>/dev/null || true
            fi
          '';
        };

        # For running directly: nix run .#
        apps.default = {
          type = "app";
          program = "${vers-agent}/bin/vers-agent";
        };
      }
    );
}
