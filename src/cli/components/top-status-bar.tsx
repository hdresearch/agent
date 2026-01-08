import React from "react";
import { Box, Text } from "ink";
import { MODEL_CONTEXT_LIMITS } from "../constants";
import { formatTokens } from "../utils/formatting";

interface TopStatusBarProps {
  model: string;
  cost: { totalCost: number; inputTokens: number; outputTokens: number };
  connected: boolean;
  planMode: boolean;
  sessionId: string | null;
  serverUrl?: string;
  agentName?: string | null;
}

export function TopStatusBar({
  model,
  cost,
  connected,
  planMode,
  sessionId,
  serverUrl,
  agentName,
}: TopStatusBarProps) {
  // Extract host:port from serverUrl for display
  const serverDisplay = (() => {
    if (!serverUrl) return null;
    try {
      const url = new URL(serverUrl);
      const host = url.hostname;
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      // Show full hostname:port
      return `${host}:${port}`;
    } catch {
      return null;
    }
  })();

  // Display name: combine agent shortName with model (e.g., "claude-opus")
  const displayName = agentName ? `${agentName}-${model}` : model;
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
        {serverDisplay && (
          <Text color={connected ? "green" : "red"}>●</Text>
        )}
        <Text color="cyan" bold>{displayName}</Text>
        {serverDisplay && (
          <>
            <Text dimColor>@</Text>
            <Text color="blue">{serverDisplay}</Text>
          </>
        )}
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
