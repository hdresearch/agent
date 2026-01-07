// Image handling utilities for prompts
// Detects image paths and converts to base64 for Claude API

import { appendFileSync, watch, readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join, basename } from "path";

// Debug logging to file (console.error gets swallowed by Ink)
function debugLog(msg: string) {
  try {
    appendFileSync("/tmp/vers-image-debug.log", `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // Ignore
  }
}

// Claude Code uses this pattern to detect macOS screenshot temp paths
// The key insight is that the temp files are in TemporaryItems subdirectory
const TEMPORARY_ITEMS_SCREENSHOT_PATTERN = /\/TemporaryItems\/.*screencaptureui.*\/Screenshot/i;

// Cache for recently captured screenshots (watched from temp directory)
// Key: filename, Value: { base64, timestamp }
const screenshotCache = new Map<string, { base64: string; timestamp: number }>();
const CACHE_TTL_MS = 30000; // 30 seconds

// Watch macOS temp directories for screenshot files
let watcherStarted = false;

function startScreenshotWatcher() {
  if (watcherStarted || process.platform !== "darwin") return;
  watcherStarted = true;

  // macOS creates temp screenshot files in /var/folders/.../T/
  const tmpDir = process.env.TMPDIR || "/tmp";
  // TemporaryItems is where screenshot files actually live when dragged
  const temporaryItemsDir = join(tmpDir, "TemporaryItems");

  try {
    // Watch both TMPDIR and TMPDIR/TemporaryItems
    const watchDir = (dir: string, label: string) => {
      if (!existsSync(dir)) {
        debugLog(`${label} does not exist: ${dir}`);
        return;
      }

      watch(dir, { recursive: false }, async (eventType, filename) => {
        if (!filename) return;

        // Match both NSIRD_screencaptureui and just screencaptureui patterns
        if (!filename.toLowerCase().includes("screencaptureui")) return;

        debugLog(`${label} watcher detected: ${eventType} ${filename}`);

        const dirPath = join(dir, filename);
        try {
          const stat = statSync(dirPath);
          if (stat.isDirectory()) {
            // Watch inside the screencaptureui directory for the actual screenshot
            watchScreenshotDir(dirPath);
          }
        } catch {
          // Directory might already be deleted
        }
      });

      // Also scan for existing screencaptureui directories
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (entry.toLowerCase().includes("screencaptureui")) {
            watchScreenshotDir(join(dir, entry));
          }
        }
      } catch {
        // Ignore scan errors
      }

      debugLog(`${label} watcher started on ${dir}`);
    };

    // Watch both directories
    watchDir(tmpDir, "TMPDIR");
    watchDir(temporaryItemsDir, "TemporaryItems");

  } catch (err) {
    debugLog(`Failed to start screenshot watcher: ${err}`);
  }
}

function watchScreenshotDir(dirPath: string) {
  try {
    // Immediately scan for any PNG files
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      if (entry.endsWith(".png")) {
        cacheScreenshot(join(dirPath, entry), entry);
      }
    }

    // Watch for new files
    watch(dirPath, async (eventType, filename) => {
      if (!filename || !filename.endsWith(".png")) return;
      cacheScreenshot(join(dirPath, filename), filename);
    });
  } catch {
    // Directory might not exist or be accessible
  }
}

async function cacheScreenshot(filePath: string, filename: string) {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return;

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    if (base64.length > 0) {
      screenshotCache.set(filename, { base64, timestamp: Date.now() });
      debugLog(`Cached screenshot: ${filename} (${base64.length} bytes)`);

      // Clean old entries
      const now = Date.now();
      for (const [key, value] of screenshotCache) {
        if (now - value.timestamp > CACHE_TTL_MS) {
          screenshotCache.delete(key);
        }
      }
    }
  } catch (err) {
    debugLog(`Failed to cache screenshot ${filename}: ${err}`);
  }
}

// Get cached screenshot by filename
export function getCachedScreenshot(filename: string): string | null {
  const cached = screenshotCache.get(filename);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    debugLog(`Found cached screenshot: ${filename}`);
    return cached.base64;
  }
  return null;
}

// Start watcher on module load
startScreenshotWatcher();

// Supported image extensions
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

// Pattern for macOS screenshot temp paths (deleted almost immediately)
// Matches both NSIRD_screencaptureui and TemporaryItems patterns
const MACOS_SCREENSHOT_TEMP_PATTERN = /NSIRD_screencaptureui.*\/Screenshot/i;

// Check if path is a macOS screenshot temp file
export function isMacOSScreenshotTempPath(path: string): boolean {
  return MACOS_SCREENSHOT_TEMP_PATTERN.test(path) || TEMPORARY_ITEMS_SCREENSHOT_PATTERN.test(path);
}

// Read image from system clipboard using multiple methods
export async function readImageFromClipboard(): Promise<{
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
} | null> {
  // Try clipboard-image package first (most reliable on macOS)
  if (process.platform === "darwin") {
    try {
      const { hasClipboardImages, readClipboardImages } = await import("clipboard-image");

      if (await hasClipboardImages()) {
        debugLog("clipboard-image: has images");
        const tempPaths = await readClipboardImages();
        debugLog(`clipboard-image: got ${tempPaths.length} temp paths`);

        if (tempPaths.length > 0) {
          const tempPath = tempPaths[0]!;
          debugLog(`clipboard-image: reading ${tempPath}`);

          // Read the temp file
          const buffer = readFileSync(tempPath);
          const base64 = buffer.toString("base64");

          // Clean up temp files
          for (const p of tempPaths) {
            try {
              Bun.spawn(["rm", p]);
            } catch {
              // Ignore cleanup errors
            }
          }

          if (base64.length > 0) {
            debugLog(`clipboard-image: got ${base64.length} bytes base64`);
            return {
              base64,
              mediaType: "image/png",
            };
          }
        }
      } else {
        debugLog("clipboard-image: no images in clipboard");
      }
    } catch (err) {
      debugLog(`clipboard-image error: ${err}`);
    }
  }

  // Try @crosscopy/clipboard next
  try {
    // Dynamic import to avoid issues if the native module isn't available
    const Clipboard = (await import("@crosscopy/clipboard")).default;

    // Check if clipboard has an image
    if (!(await Clipboard.hasImage())) {
      debugLog("@crosscopy/clipboard: no image");
      // Fallback to osascript on macOS
      if (process.platform === "darwin") {
        return readImageFromClipboardOsascript();
      }
      return null;
    }

    // Get the image as base64
    const base64 = await Clipboard.getImageBase64();
    if (!base64 || base64.length === 0) {
      return null;
    }

    debugLog(`@crosscopy/clipboard: got ${base64.length} bytes base64`);
    return {
      base64,
      mediaType: "image/png", // @crosscopy/clipboard returns PNG format
    };
  } catch (err) {
    debugLog(`@crosscopy/clipboard error: ${err}`);
    // Fallback to osascript on macOS if the native module fails
    if (process.platform === "darwin") {
      return readImageFromClipboardOsascript();
    }
    return null;
  }
}

// Get file path from macOS clipboard (when a file is dragged/copied)
// This is different from image data - it gets the actual file path reference
export async function getClipboardFilePath(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const proc = Bun.spawn(
      ["osascript", "-e", "get POSIX path of (the clipboard as «class furl»)"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const path = output.trim();
    // Validate the path exists and isn't just "/" (which osascript returns on error)
    if (path && path !== "/" && path.length > 1) {
      return path;
    }
    return null;
  } catch {
    return null;
  }
}

// Fallback: Read image from macOS clipboard using osascript
async function readImageFromClipboardOsascript(): Promise<{
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
} | null> {
  try {
    const tempPath = `/tmp/vers-clipboard-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;

    const script = `
      try
        set theImage to the clipboard as «class PNGf»
        set theFile to open for access POSIX file "${tempPath}" with write permission
        write theImage to theFile
        close access theFile
        return "ok"
      on error errMsg
        try
          close access POSIX file "${tempPath}"
        end try
        return "error: " & errMsg
      end try
    `;

    const proc = Bun.spawn(["osascript", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    if (!output.trim().startsWith("ok")) {
      return null;
    }

    const tempFile = Bun.file(tempPath);
    if (!(await tempFile.exists())) {
      return null;
    }

    const buffer = await tempFile.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Clean up temp file
    try {
      await Bun.spawn(["rm", tempPath]).exited;
    } catch {
      // Ignore cleanup errors
    }

    if (base64.length === 0) {
      return null;
    }

    return {
      base64,
      mediaType: "image/png",
    };
  } catch {
    return null;
  }
}

// Match @path references that are images
const AT_PATH_PATTERN = /@(?:"([^"]+)"|'([^']+)'|([^\s,;:!?\])}>]+))/g;

// Match paths from drag-and-drop (Finder)
// Handles: /path/to/file.png, '/path/to/file.png', "/path/to/file.png", ~/path/file.png
// Also handles relative paths: ./file.png, dir/file.png
// Also handles escaped spaces: /path/to/file\ with\ spaces.png

// Special pattern for macOS screenshot temp paths (which have inconsistent space escaping)
// Matches: NSIRD_screencaptureui_XXXXX/Screenshot... .png
// This pattern is greedy and captures everything up to .png
const MACOS_SCREENSHOT_PATH_PATTERN = /(NSIRD_screencaptureui_[a-zA-Z0-9]+\/Screenshot[^\n]*\.png)/g;

// Quoted paths (single or double quotes) - absolute or relative
const QUOTED_PATH_PATTERN = /(?<!@)"([^"]+\.[a-zA-Z]+)"|'([^']+\.[a-zA-Z]+)'/g;

// Unquoted paths with possible escaped spaces
// Matches: /abs/path, ~/home/path, ./relative, or relative/path (must contain /)
// The path must end with a file extension
const UNQUOTED_PATH_PATTERN = /(?<![@"'])((?:\/|~\/|\.\/|[a-zA-Z0-9_-]+\/)(?:[^\s\\]|\\ )*\.[a-zA-Z]+)/g;

export interface ImageReference {
  original: string; // The full match including @
  path: string; // The extracted path
  startIndex: number;
  endIndex: number;
}

export interface ProcessedImage {
  id: number; // Sequential ID for display as [Image #N]
  path: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64: string;
  error?: string;
}

// Global counter for image IDs (reset per session)
let imageCounter = 0;

export function resetImageCounter(): void {
  imageCounter = 0;
}

export function getNextImageId(): number {
  return ++imageCounter;
}

export function formatImageMarker(id: number): string {
  return `[Image #${id}]`;
}

// Check if a path is an image based on extension
export function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Get media type from path
function getMediaType(path: string): ProcessedImage["mediaType"] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png"; // default
}

// Normalize a path (unescape backslash-spaces, expand ~)
function normalizePath(path: string): string {
  // Unescape backslash-spaces (from terminal drag-drop)
  let normalized = path.replace(/\\ /g, " ");
  // Expand ~ to home directory
  if (normalized.startsWith("~/")) {
    normalized = normalized.replace("~", process.env.HOME || "~");
  }
  return normalized;
}

// Extract image references from text
export function extractImageReferences(text: string): ImageReference[] {
  const refs: ImageReference[] = [];
  const coveredRanges: Array<[number, number]> = []; // Track ranges to avoid overlaps
  let match: RegExpExecArray | null;

  // Helper to check if a range overlaps with existing refs
  const overlaps = (start: number, end: number): boolean => {
    return coveredRanges.some(([s, e]) => !(end <= s || start >= e));
  };

  // First, check for macOS screenshot temp paths (highest priority, most specific)
  // These have inconsistent space escaping so need special handling
  MACOS_SCREENSHOT_PATH_PATTERN.lastIndex = 0;
  while ((match = MACOS_SCREENSHOT_PATH_PATTERN.exec(text)) !== null) {
    const path = match[1];
    if (path) {
      refs.push({
        original: match[0],
        path: normalizePath(path),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
      coveredRanges.push([match.index, match.index + match[0].length]);
    }
  }

  // Check for @path references
  AT_PATH_PATTERN.lastIndex = 0;
  while ((match = AT_PATH_PATTERN.exec(text)) !== null) {
    if (overlaps(match.index, match.index + match[0].length)) continue;
    const path = match[1] || match[2] || match[3];
    if (path && isImagePath(path)) {
      refs.push({
        original: match[0],
        path: normalizePath(path),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
      coveredRanges.push([match.index, match.index + match[0].length]);
    }
  }

  // Check for quoted paths (absolute or relative)
  QUOTED_PATH_PATTERN.lastIndex = 0;
  while ((match = QUOTED_PATH_PATTERN.exec(text)) !== null) {
    if (overlaps(match.index, match.index + match[0].length)) continue;
    const path = match[1] || match[2];
    if (path && isImagePath(path)) {
      refs.push({
        original: match[0],
        path: normalizePath(path),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
      coveredRanges.push([match.index, match.index + match[0].length]);
    }
  }

  // Check for unquoted paths (with possible escaped spaces)
  UNQUOTED_PATH_PATTERN.lastIndex = 0;
  while ((match = UNQUOTED_PATH_PATTERN.exec(text)) !== null) {
    if (overlaps(match.index, match.index + match[0].length)) continue;
    const path = match[1];
    if (path && isImagePath(path)) {
      refs.push({
        original: match[0],
        path: normalizePath(path),
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
      coveredRanges.push([match.index, match.index + match[0].length]);
    }
  }

  // Sort by start index
  refs.sort((a, b) => a.startIndex - b.startIndex);

  return refs;
}

// Read and encode an image as base64
export async function readImageAsBase64(
  imagePath: string,
  cwd: string
): Promise<ProcessedImage> {
  const { resolve, isAbsolute } = await import("path");

  const absolutePath = isAbsolute(imagePath) ? imagePath : resolve(cwd, imagePath);
  const id = getNextImageId();

  try {
    const file = Bun.file(absolutePath);
    let fileExists = await file.exists();
    let actualPath = absolutePath;

    // If file doesn't exist and it's a macOS screenshot temp path, try fallbacks
    if (!fileExists && isMacOSScreenshotTempPath(imagePath)) {
      debugLog(`Temp file not found: ${absolutePath}`);

      // The dragged path might be relative - try resolving against TMPDIR
      // macOS creates screenshot temp files in /var/folders/.../T/NSIRD_screencaptureui_.../
      // OR in /var/folders/.../T/TemporaryItems/NSIRD_screencaptureui_.../
      const tmpDir = process.env.TMPDIR || "/tmp";
      const temporaryItemsDir = join(tmpDir, "TemporaryItems");

      // Extract the NSIRD portion from the path (works for both patterns)
      const nsirdMatch = imagePath.match(/((?:NSIRD_)?screencaptureui[^\/]*\/[^\/]+\.png)/i);
      if (nsirdMatch) {
        // Try multiple possible locations
        const pathsToTry = [
          join(tmpDir, nsirdMatch[1]),
          join(temporaryItemsDir, nsirdMatch[1]),
          join(temporaryItemsDir, "NSIRD_" + nsirdMatch[1]),
        ];

        for (const tryPath of pathsToTry) {
          debugLog(`Trying path: ${tryPath}`);
          const tryFile = Bun.file(tryPath);
          if (await tryFile.exists()) {
            debugLog(`Found file at: ${tryPath}`);
            actualPath = tryPath;
            fileExists = true;
            break;
          }
        }
      }

      // Check if we cached this screenshot from file watcher
      if (!fileExists) {
        const screenshotFilename = basename(absolutePath);
        const cachedBase64 = getCachedScreenshot(screenshotFilename);
        if (cachedBase64) {
          debugLog(`Using cached screenshot: ${screenshotFilename}`);
          return {
            id,
            path: `screenshot (cached): ${screenshotFilename}`,
            mediaType: "image/png" as const,
            base64: cachedBase64,
          };
        }
      }

      // Next, try to get the file path from clipboard
      // macOS screenshot capture puts the file reference in clipboard when dragged
      const clipboardPath = await getClipboardFilePath();
      debugLog(`Clipboard file path: ${clipboardPath}`);

      if (clipboardPath) {
        const clipboardBasename = basename(clipboardPath);
        const expectedBasename = basename(absolutePath);
        debugLog(`Expected basename: ${expectedBasename}, Clipboard basename: ${clipboardBasename}`);

        // Check if the basename matches (the screenshot filename)
        if (clipboardBasename === expectedBasename) {
          const clipboardFile = Bun.file(clipboardPath);
          if (await clipboardFile.exists()) {
            debugLog(`Found matching file in clipboard path!`);
            actualPath = clipboardPath;
            fileExists = true;
          }
        }
      }

      // If still no file, try clipboard image data
      if (!fileExists) {
        debugLog(`Trying clipboard image data...`);
        const clipboardImage = await readImageFromClipboard();
        debugLog(`Clipboard image: ${clipboardImage ? 'found' : 'not found'}`);

        if (clipboardImage) {
          return {
            id,
            path: "clipboard (screenshot)",
            mediaType: clipboardImage.mediaType,
            base64: clipboardImage.base64,
          };
        }
        return {
          id,
          path: absolutePath,
          mediaType: getMediaType(imagePath),
          base64: "",
          error: `Screenshot temp file was deleted before it could be read. To attach screenshots: use Cmd+Ctrl+Shift+4 (copies to clipboard), then Ctrl+V to paste`,
        };
      }
    }

    if (!fileExists) {
      return {
        id,
        path: absolutePath,
        mediaType: getMediaType(imagePath),
        base64: "",
        error: `Image not found: ${absolutePath}`,
      };
    }

    // Re-get the file handle from actualPath (may be different from original if clipboard fallback was used)
    const actualFile = Bun.file(actualPath);

    // Check file size (limit to 20MB)
    const size = actualFile.size;
    if (size > 20 * 1024 * 1024) {
      return {
        id,
        path: actualPath,
        mediaType: getMediaType(actualPath),
        base64: "",
        error: `Image too large (${(size / 1024 / 1024).toFixed(1)}MB, max 20MB)`,
      };
    }

    const buffer = await actualFile.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return {
      id,
      path: actualPath,
      mediaType: getMediaType(actualPath),
      base64,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id,
      path: absolutePath,
      mediaType: getMediaType(imagePath),
      base64: "",
      error: `Failed to read image: ${msg}`,
    };
  }
}

// Check if prompt contains any image references
export function hasImageReferences(prompt: string): boolean {
  return extractImageReferences(prompt).length > 0;
}

// Process prompt to extract images and return modified prompt + images
export async function processImagesInPrompt(
  prompt: string,
  cwd: string = process.cwd()
): Promise<{
  textPrompt: string; // Prompt with image refs removed/replaced
  images: ProcessedImage[];
  errors: string[];
}> {
  const refs = extractImageReferences(prompt);

  if (refs.length === 0) {
    return { textPrompt: prompt, images: [], errors: [] };
  }

  const images: ProcessedImage[] = [];
  const errors: string[] = [];

  // Process all images in parallel
  const processedImages = await Promise.all(
    refs.map((ref) => readImageAsBase64(ref.path, cwd))
  );

  // Build modified prompt (remove image references)
  let textPrompt = prompt;
  let offset = 0;

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!;
    const processed = processedImages[i]!;

    if (processed.error) {
      errors.push(processed.error);
      // Replace with error marker - still show the ID for reference
      const replacement = `[Image #${processed.id} error: ${processed.error}]`;
      const start = ref.startIndex + offset;
      const end = ref.endIndex + offset;
      textPrompt = textPrompt.slice(0, start) + replacement + textPrompt.slice(end);
      offset += replacement.length - (ref.endIndex - ref.startIndex);
    } else {
      images.push(processed);
      // Replace with image marker like Claude Code does: [Image #N]
      const replacement = formatImageMarker(processed.id);
      const start = ref.startIndex + offset;
      const end = ref.endIndex + offset;
      textPrompt = textPrompt.slice(0, start) + replacement + textPrompt.slice(end);
      offset += replacement.length - (ref.endIndex - ref.startIndex);
    }
  }

  return { textPrompt, images, errors };
}
