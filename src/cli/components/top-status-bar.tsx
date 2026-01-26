import React from "react";
import { Box, Text } from "ink";

/**
 * Terminal hyperlink using OSC 8 escape sequence
 */
function TerminalLink({ url, children }: { url: string; children: React.ReactNode }) {
  const linkStart = `\x1b]8;;${url}\x1b\\`;
  const linkEnd = `\x1b]8;;\x1b\\`;
  return (
    <Text>
      {linkStart}
      {children}
      {linkEnd}
    </Text>
  );
}

interface TopStatusBarProps {
  model: string;
  connected: boolean;
  planMode: boolean;
  sessionId: string | null;
  serverUrl?: string;
  agentName?: string | null;
  /** VM counts for mini status */
  vmStats?: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
  /** URL to the web canvas/shell */
  canvasUrl?: string;
}

export function TopStatusBar({
  model,
  connected,
  planMode,
  sessionId,
  serverUrl,
  agentName,
  vmStats,
  canvasUrl,
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

  // VM status summary
  const hasVms = vmStats && vmStats.total > 0;

  return (
    <Box flexDirection="row" marginBottom={1} gap={1}>
      {/* Main status box */}
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        flexGrow={1}
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

      {/* VM stats box - separate from main status */}
      {hasVms && (
        <Box
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
        >
          <Text color="yellow">{vmStats.total} VMs</Text>
          {vmStats.running > 0 && (
            <Text color="green"> ({vmStats.running} active)</Text>
          )}
          <Text dimColor> │ </Text>
          {canvasUrl ? (
            <TerminalLink url={canvasUrl}>
              <Text color="magenta" bold>[C]</Text>
              <Text color="magenta">anvas</Text>
            </TerminalLink>
          ) : (
            <>
              <Text color="magenta" bold>[C]</Text>
              <Text color="magenta">anvas</Text>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
