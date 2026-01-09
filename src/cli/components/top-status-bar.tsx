import React from "react";
import { Box, Text } from "ink";

interface TopStatusBarProps {
  model: string;
  connected: boolean;
  planMode: boolean;
  sessionId: string | null;
  serverUrl?: string;
  agentName?: string | null;
}

export function TopStatusBar({
  model,
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
