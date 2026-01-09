// PermissionDialog component tests

import React from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { render } from "ink-testing-library";
import { PermissionDialog } from "../../../src/cli/components/permission-dialog";
import { createMockPermissionRequest, waitForEffects, waitUntil } from "./test-utils";
import type { PermissionRequest } from "../../../src/cli/types";

describe("PermissionDialog", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  const defaultRequest: PermissionRequest = createMockPermissionRequest({
    toolCall: {
      toolCallId: "test-1",
      title: "Write to file.txt",
      locations: [],
    },
    options: [
      { optionId: "allow", kind: "allow_once", name: "Allow once" },
      { optionId: "deny", kind: "reject_once", name: "Deny once" },
    ],
  });

  describe("Rendering", () => {
    test("renders permission dialog with header", () => {
      const { lastFrame, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={() => {}}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      const frame = lastFrame();
      expect(frame).toContain("Permission Required");
    });

    test("renders tool title", () => {
      const { lastFrame, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={() => {}}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      const frame = lastFrame();
      expect(frame).toContain("Write to file.txt");
    });

    test("renders all options with numbers", () => {
      const { lastFrame, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={() => {}}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      const frame = lastFrame();
      expect(frame).toContain("[1]");
      expect(frame).toContain("[2]");
      expect(frame).toContain("Allow once");
      expect(frame).toContain("Deny once");
    });

    test("renders help text", () => {
      const { lastFrame, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={() => {}}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      const frame = lastFrame();
      expect(frame).toContain("select");
      expect(frame).toContain("confirm");
    });

    test("truncates long tool titles", () => {
      const longTitleRequest = createMockPermissionRequest({
        toolCall: {
          toolCallId: "test-1",
          title: "This is a very long tool title that should be truncated because it exceeds sixty characters",
          locations: [],
        },
      });

      const { lastFrame, unmount } = render(
        <PermissionDialog
          request={longTitleRequest}
          onRespond={() => {}}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      const frame = lastFrame();
      expect(frame).toContain("...");
      // Should not contain the full long title
      expect(frame).not.toContain("exceeds sixty characters");
    });

    test("renders file locations when provided", () => {
      const requestWithLocations = createMockPermissionRequest({
        toolCall: {
          toolCallId: "test-1",
          title: "Read files",
          locations: [
            { path: "/path/to/file.ts", line: 42 },
            { path: "/path/to/other.ts" },
          ],
        },
      });

      const { lastFrame, unmount } = render(
        <PermissionDialog
          request={requestWithLocations}
          onRespond={() => {}}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      const frame = lastFrame();
      expect(frame).toContain("/path/to/file.ts:42");
      expect(frame).toContain("/path/to/other.ts");
    });
  });

  describe("Keyboard Input", () => {
    test("y key triggers allow option", async () => {
      let responded = "";
      const { stdin, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={(id) => {
            responded = id;
          }}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      stdin.write("y");
      await waitUntil(() => responded !== "");

      expect(responded).toBe("allow");
    });

    test("Y key (uppercase) also triggers allow option", async () => {
      let responded = "";
      const { stdin, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={(id) => {
            responded = id;
          }}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      stdin.write("Y");
      await waitUntil(() => responded !== "");

      expect(responded).toBe("allow");
    });

    test("n key triggers deny option", async () => {
      let responded = "";
      const { stdin, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={(id) => {
            responded = id;
          }}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      stdin.write("n");
      await waitUntil(() => responded !== "");

      expect(responded).toBe("deny");
    });

    test("number key 1 selects first option", async () => {
      let responded = "";
      const { stdin, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={(id) => {
            responded = id;
          }}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      stdin.write("1");
      await waitUntil(() => responded !== "");

      expect(responded).toBe("allow");
    });

    test("number key 2 selects second option", async () => {
      let responded = "";
      const { stdin, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={(id) => {
            responded = id;
          }}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      stdin.write("2");
      await waitUntil(() => responded !== "");

      expect(responded).toBe("deny");
    });

    test("escape key triggers cancel", async () => {
      let cancelled = false;
      const { stdin, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={() => {}}
          onCancel={() => {
            cancelled = true;
          }}
        />
      );
      cleanup = unmount;

      stdin.write("\u001B"); // Escape key
      await waitUntil(() => cancelled);

      expect(cancelled).toBe(true);
    });

    test("enter key confirms current selection", async () => {
      let responded = "";
      const { stdin, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={(id) => {
            responded = id;
          }}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      // Default selection is first item
      stdin.write("\r"); // Enter key
      await waitUntil(() => responded !== "");

      expect(responded).toBe("allow");
    });

    test("arrow down then enter selects second option", async () => {
      let responded = "";
      const { stdin, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={(id) => {
            responded = id;
          }}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      stdin.write("\u001B[B"); // Arrow down
      await waitForEffects(100); // Give time for arrow key to be processed
      stdin.write("\r"); // Enter
      await waitUntil(() => responded !== "");

      expect(responded).toBe("deny");
    });

    test("invalid number key does nothing", async () => {
      let responded = "";
      const { stdin, unmount } = render(
        <PermissionDialog
          request={defaultRequest}
          onRespond={(id) => {
            responded = id;
          }}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      stdin.write("9"); // Only 2 options, so 9 is invalid
      await waitForEffects();

      expect(responded).toBe(""); // No response
    });
  });

  describe("Multiple Options", () => {
    test("handles four options", async () => {
      const fourOptionRequest = createMockPermissionRequest({
        toolCall: {
          toolCallId: "test-1",
          title: "Complex operation",
          locations: [],
        },
        options: [
          { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
          { optionId: "allow-always", kind: "allow_always", name: "Allow always" },
          { optionId: "deny-once", kind: "reject_once", name: "Deny once" },
          { optionId: "deny-always", kind: "reject_always", name: "Deny always" },
        ],
      });

      const { lastFrame, unmount } = render(
        <PermissionDialog
          request={fourOptionRequest}
          onRespond={() => {}}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      const frame = lastFrame();
      expect(frame).toContain("[1]");
      expect(frame).toContain("[2]");
      expect(frame).toContain("[3]");
      expect(frame).toContain("[4]");
    });

    test("number key 4 selects fourth option", async () => {
      let responded = "";
      const fourOptionRequest = createMockPermissionRequest({
        toolCall: {
          toolCallId: "test-1",
          title: "Complex operation",
          locations: [],
        },
        options: [
          { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
          { optionId: "allow-always", kind: "allow_always", name: "Allow always" },
          { optionId: "deny-once", kind: "reject_once", name: "Deny once" },
          { optionId: "deny-always", kind: "reject_always", name: "Deny always" },
        ],
      });

      const { stdin, unmount } = render(
        <PermissionDialog
          request={fourOptionRequest}
          onRespond={(id) => {
            responded = id;
          }}
          onCancel={() => {}}
        />
      );
      cleanup = unmount;

      stdin.write("4");
      await waitUntil(() => responded !== "");

      expect(responded).toBe("deny-always");
    });
  });
});
