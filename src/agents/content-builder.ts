// Content block builder - constructs ACP content blocks from prompt options

import type { AcpContentBlock, RunPromptOptions } from "./types";

/**
 * Build ACP content blocks from RunPromptOptions.
 * Converts text, images, and attachments into the ACP content block format.
 */
export function buildContentBlocks(options: RunPromptOptions): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = [];

  // Add text
  if (options.prompt) {
    blocks.push({ type: "text", text: options.prompt });
  }

  // Add images
  if (options.images) {
    for (const img of options.images) {
      if (img.base64 && !img.error) {
        blocks.push({
          type: "image",
          data: img.base64,
          mimeType: img.mediaType,
        });
      }
    }
  }

  // Add attachments
  if (options.attachments) {
    for (const att of options.attachments) {
      if (att.type === "image" && att.content) {
        blocks.push({
          type: "image",
          data: att.content,
          mimeType: att.mimeType || "image/png",
        });
      }
    }
  }

  return blocks;
}
