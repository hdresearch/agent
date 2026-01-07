import React from "react";
import { Box, Text } from "ink";
import { MODEL_CONTEXT_LIMITS } from "../constants";
import { formatTokens } from "../utils/formatting";

interface TopStatusBarProps {
  model: string;
  thinking: { enabled: boolean; budget?: number | null };
  cost: { totalCost: number; inputTokens: number; outputTokens: number };
  connected: boolean;
  planMode: boolean;
  sessionId: string | null;
}

export function TopStatusBar({
  model,
  thinking,
  cost,
  connected,
  planMode,
  sessionId,
}: TopStatusBarProps) {
  const contextLimit = MODEL_CONTEXT_LIMITS[model] || 200000;
  const contextUsed = cost.inputTokens; // Input tokens represent context usage
  const contextPercent = Math.min(100, (contextUsed / contextLimit) * 100);

  // Color based on usage
  let contextColor: string = "green";
  if (contextPercent > 80) contextColor = "red";
  else if (contextPercent > 60) contextColor = "yellow";

  // Visual bar (5 chars wide)
  const barFilled = Math.round(contextPercent / 20);
  const bar = "█".repeat(barFilled) + "░".repeat(5 - barFilled);

  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginBottom={1}
    >
      <Box flexGrow={1} gap={1}>
        <Text color="cyan" bold>vers-agent</Text>
        <Text dimColor>│</Text>
        <Text color="magenta">{model}</Text>
        <Text dimColor>│</Text>
        <Text color={thinking.enabled ? "yellow" : "gray"}>
          {thinking.enabled ? `🧠 ${(thinking.budget || 10000).toLocaleString()}` : "🧠 off"}
        </Text>
        {planMode && (
          <>
            <Text dimColor>│</Text>
            <Text color="cyan" bold>📋 PLAN</Text>
          </>
        )}
        <Text dimColor>│</Text>
        <Text color="green">${cost.totalCost.toFixed(4)}</Text>
        <Text dimColor>│</Text>
        <Text color={contextColor}>
          {bar} {formatTokens(contextUsed)}/{formatTokens(contextLimit)}
        </Text>
        <Text dimColor>({formatTokens(cost.outputTokens)} out)</Text>
        {sessionId && (
          <>
            <Text dimColor>│</Text>
            <Text color="gray">{sessionId.slice(0, 8)}</Text>
          </>
        )}
        {!connected && (
          <>
            <Text dimColor>│</Text>
            <Text color="red">disconnected</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
