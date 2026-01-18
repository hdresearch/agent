#!/usr/bin/env bash
# Experiment Runner Utility
#
# Usage: ./run-experiment.sh <experiment-name>
# Example: ./run-experiment.sh gf3-demo

set -euo pipefail

EXPERIMENTS_DIR="$(cd "$(dirname "$0")" && pwd)"
NBB_DIR="$EXPERIMENTS_DIR/nbb"
RESULTS_DIR="$EXPERIMENTS_DIR/results"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_usage() {
    echo "Usage: $0 <experiment-name>"
    echo ""
    echo "Available experiments:"
    for file in "$NBB_DIR"/*.cljs; do
        name=$(basename "$file" .cljs)
        echo "  - $name"
    done
}

check_nbb() {
    if ! command -v nbb &> /dev/null; then
        echo -e "${RED}Error: nbb is not installed${NC}"
        echo ""
        echo "Install with:"
        echo "  npm install -g nbb"
        echo "  or"
        echo "  bun install -g nbb"
        exit 1
    fi
}

run_experiment() {
    local experiment=$1
    local script="$NBB_DIR/${experiment}.cljs"
    
    if [ ! -f "$script" ]; then
        echo -e "${RED}Error: Experiment '$experiment' not found${NC}"
        echo ""
        print_usage
        exit 1
    fi
    
    echo -e "${BLUE}Running experiment: ${experiment}${NC}"
    echo -e "${YELLOW}Script: ${script}${NC}"
    echo ""
    
    # Create results directory if it doesn't exist
    mkdir -p "$RESULTS_DIR"
    
    # Timestamp for results
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    RESULT_FILE="$RESULTS_DIR/${experiment}_${TIMESTAMP}.txt"
    
    # Run the experiment and tee to result file
    if nbb "$script" | tee "$RESULT_FILE"; then
        echo ""
        echo -e "${GREEN}✓ Experiment completed successfully${NC}"
        echo -e "${BLUE}Results saved to: ${RESULT_FILE}${NC}"
    else
        echo ""
        echo -e "${RED}✗ Experiment failed${NC}"
        exit 1
    fi
}

# Main
if [ $# -eq 0 ]; then
    echo -e "${RED}Error: No experiment specified${NC}"
    echo ""
    print_usage
    exit 1
fi

check_nbb
run_experiment "$1"
