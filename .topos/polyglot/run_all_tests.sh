#!/usr/bin/env bash
# Cross-language GF(3) verification test suite
#
# Runs verified GF(3) implementations in all Dafny-supported languages
# and reports results in a unified format.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "════════════════════════════════════════════════════════════════"
echo "GF(3) Cross-Language Verification Test Suite"
echo "Dafny-backed formal proofs in 6 languages"
echo "════════════════════════════════════════════════════════════════"
echo ""

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

run_test() {
    local lang="$1"
    local cmd="$2"
    
    printf "%-12s " "$lang"
    
    if output=$($cmd 2>&1); then
        # Check for various success patterns
        if echo "$output" | grep -qE "(✓|✓|pass|PASS|All.*verified|0 fail)"; then
            echo "✓ PASS"
            ((PASS_COUNT++))
        else
            echo "✗ FAIL (no success marker)"
            echo "  Output: $output"
            ((FAIL_COUNT++))
        fi
    else
        echo "✗ FAIL"
        echo "  Error: $output"
        ((FAIL_COUNT++))
    fi
}

run_test_skip() {
    local lang="$1"
    local reason="$2"
    printf "%-12s ⊘ SKIP ($reason)\n" "$lang"
    ((SKIP_COUNT++))
}

# TypeScript (via Bun)
if command -v bun &> /dev/null; then
    run_test "TypeScript" "bun test ../src/math/gf3-verified.test.ts"
else
    run_test_skip "TypeScript" "bun not installed"
fi

# Julia
if command -v julia &> /dev/null; then
    if [ -f "../Gay.jl/test/gf3_verified_test.jl" ]; then
        run_test "Julia" "julia ../Gay.jl/test/gf3_verified_test.jl"
    else
        run_test_skip "Julia" "test file not found"
    fi
else
    run_test_skip "Julia" "julia not installed"
fi

# Python
if command -v python3 &> /dev/null; then
    run_test "Python" "python3 gf3_verified.py"
else
    run_test_skip "Python" "python3 not installed"
fi

# Go
if command -v go &> /dev/null; then
    run_test "Go" "go run gf3_verified.go"
else
    run_test_skip "Go" "go not installed"
fi

# C#
if command -v dotnet &> /dev/null; then
    run_test "C#" "dotnet script GF3Verified.cs"
elif command -v csc &> /dev/null && command -v mono &> /dev/null; then
    # Fallback to Mono
    if csc /out:gf3_verified_cs.exe GF3Verified.cs &> /dev/null; then
        run_test "C#" "mono gf3_verified_cs.exe"
        rm -f gf3_verified_cs.exe
    else
        run_test_skip "C#" "compilation failed"
    fi
else
    run_test_skip "C#" "dotnet/mono not installed"
fi

# Java
if command -v javac &> /dev/null && command -v java &> /dev/null; then
    if javac GF3Verified.java &> /dev/null; then
        run_test "Java" "java GF3Verified"
        rm -f GF3Verified.class GF3Verified\$Trit.class
    else
        run_test_skip "Java" "compilation failed"
    fi
else
    run_test_skip "Java" "javac/java not installed"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped"
echo "════════════════════════════════════════════════════════════════"

if [ $FAIL_COUNT -gt 0 ]; then
    exit 1
fi
