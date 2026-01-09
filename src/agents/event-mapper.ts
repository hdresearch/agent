// Event mapper - converts ACP session updates to PromptEvents

import type {
  PromptEvent,
  AcpSessionUpdate,
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpAvailableCommandsUpdate,
} from "./types";
import { cleanTitle } from "../utils/string-utils";

/**
 * Map an ACP session update to a PromptEvent for the UI layer.
 * Returns null if the update doesn't map to a displayable event.
 */
export function mapSessionUpdateToPromptEvent(update: AcpSessionUpdate): PromptEvent | null {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const chunk = update as AcpAgentMessageChunk;
      if (chunk.content.type === "text") {
        return {
          type: "text_delta",
          data: { text: chunk.content.text },
        };
      }
      return null;
    }

    case "agent_thought_chunk": {
      const thought = update as AcpAgentThoughtChunk;
      if (thought.content.type === "text") {
        return {
          type: "thinking",
          data: { thinking: thought.content.text },
        };
      }
      return null;
    }

    case "tool_call": {
      const toolCall = update as AcpToolCall;
      // Use cleaned title if valid, fallback to toolCallId or "Tool"
      const displayTitle = cleanTitle(toolCall.title) || toolCall.toolCallId || "Tool";
      return {
        type: "tool_use",
        data: {
          toolCallId: toolCall.toolCallId,
          name: displayTitle,
          input: toolCall.rawInput || {},
          title: displayTitle,
          kind: toolCall.kind,
          status: toolCall.status,
          locations: toolCall.locations,
          content: toolCall.content,
        },
      };
    }

    case "tool_call_update": {
      const toolUpdate = update as AcpToolCallUpdate;
      if (toolUpdate.status) {
        return {
          type: "tool_result",
          data: {
            toolCallId: toolUpdate.toolCallId,
            status: toolUpdate.status,
            content: toolUpdate.rawOutput,
            locations: toolUpdate.locations,
            richContent: toolUpdate.content,
          },
        };
      }
      return null;
    }

    case "plan": {
      // Plans are handled separately, not mapped to PromptEvent
      return null;
    }

    case "available_commands_update": {
      const commandsUpdate = update as AcpAvailableCommandsUpdate;
      return {
        type: "available_commands",
        data: { commands: commandsUpdate.availableCommands },
      };
    }

    default:
      return null;
  }
}
