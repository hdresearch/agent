import { useState, useCallback, useRef } from "react";
import { extractImageReferences } from "../../utils/image-utils";
import type { ProcessedImage } from "../types";

export interface UseImageAttachmentsResult {
  pendingAttachments: ProcessedImage[];
  setPendingAttachments: React.Dispatch<React.SetStateAction<ProcessedImage[]>>;
  processInput: (newValue: string) => string;
  clearAttachments: () => void;
  clearProcessedPaths: () => void;
}

/**
 * Hook for managing image attachments in the CLI.
 * Detects image paths in input and converts them to base64 attachments.
 */
export function useImageAttachments(): UseImageAttachmentsResult {
  const [pendingAttachments, setPendingAttachments] = useState<ProcessedImage[]>([]);
  const imageIdCounter = useRef(0);
  const processedPathsRef = useRef<Set<string>>(new Set());

  const getNextImageId = () => ++imageIdCounter.current;

  /**
   * Process input text for image paths and return modified input.
   * Image paths are removed from the input and converted to attachments.
   */
  const processInput = useCallback((newValue: string): string => {
    // Check for image paths and read them SYNCHRONOUSLY (before macOS deletes screenshot temp files)
    const refs = extractImageReferences(newValue);
    let modifiedInput = newValue;
    const newAttachments: ProcessedImage[] = [];

    for (const ref of refs) {
      // Skip if we've already processed this path in this session
      if (processedPathsRef.current.has(ref.path)) continue;
      processedPathsRef.current.add(ref.path);

      // Try to read SYNCHRONOUSLY - check multiple locations
      try {
        const fs = require("fs");
        const pathModule = require("path");
        const cwd = process.cwd();

        // Build list of paths to try
        const pathsToTry: string[] = [];

        // 1. Absolute path as-is
        if (pathModule.isAbsolute(ref.path)) {
          pathsToTry.push(ref.path);
        } else {
          // 2. Relative to CWD
          pathsToTry.push(pathModule.resolve(cwd, ref.path));
        }

        // 3. For NSIRD/screenshot paths, try TMPDIR and TemporaryItems
        if (ref.path.toLowerCase().includes("screencaptureui")) {
          const tmpDir = process.env.TMPDIR || "/tmp";
          const temporaryItemsDir = pathModule.join(tmpDir, "TemporaryItems");
          const nsirdMatch = ref.path.match(/((?:NSIRD_)?screencaptureui[^\/]*\/[^\/]+\.png)/i);
          if (nsirdMatch) {
            pathsToTry.push(pathModule.join(tmpDir, nsirdMatch[1]));
            pathsToTry.push(pathModule.join(temporaryItemsDir, nsirdMatch[1]));
            pathsToTry.push(pathModule.join(temporaryItemsDir, "NSIRD_" + nsirdMatch[1]));
          }
        }

        // Try each path synchronously
        let imageFound = false;
        for (const tryPath of pathsToTry) {
          try {
            if (fs.existsSync(tryPath)) {
              const buffer = fs.readFileSync(tryPath);
              const base64 = buffer.toString("base64");
              if (base64.length > 0) {
                const ext = pathModule.extname(tryPath).toLowerCase();
                const mediaType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
                                  ext === ".gif" ? "image/gif" :
                                  ext === ".webp" ? "image/webp" : "image/png";

                const imageId = getNextImageId();
                const processedImage: ProcessedImage = {
                  id: imageId,
                  path: tryPath,
                  mediaType,
                  base64,
                };
                newAttachments.push(processedImage);

                // Remove the path from input text
                modifiedInput = modifiedInput.replace(ref.original, "").trim();

                imageFound = true;
                break;
              }
            }
          } catch {
            // Try next path
          }
        }

        // If no file found, we'll show an error on submit
        if (!imageFound && ref.path.toLowerCase().includes("screencaptureui")) {
          // Screenshot file not found - will try clipboard on submit
        }
      } catch {
        // Ignore sync read errors
      }
    }

    // Update pending attachments
    if (newAttachments.length > 0) {
      setPendingAttachments(prev => [...prev, ...newAttachments]);
    }

    return modifiedInput;
  }, []);

  const clearAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  const clearProcessedPaths = useCallback(() => {
    processedPathsRef.current.clear();
  }, []);

  return {
    pendingAttachments,
    setPendingAttachments,
    processInput,
    clearAttachments,
    clearProcessedPaths,
  };
}
