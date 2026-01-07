import React from "react";
import { Box } from "ink";
import { Spinner } from "./spinner";
import type { AppState } from "../types";

interface StatusBarProps {
  state: AppState;
}

export function StatusBar({ state }: StatusBarProps) {
  if (state.status === "idle") {
    return null;
  }

  return (
    <Box paddingX={2}>
      {state.status === "thinking" && <Spinner text="Thinking..." />}
      {state.status === "running-tool" && (
        <Spinner text={`Running ${state.currentTool}...`} />
      )}
    </Box>
  );
}
