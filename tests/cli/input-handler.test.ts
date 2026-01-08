import { test, expect, describe } from "bun:test";
import {
  processKeyInput,
  type KeyEvent,
  type InputState,
} from "../../src/cli/input-handler";

describe("processKeyInput", () => {
  describe("Ctrl+C behavior", () => {
    test("clears input when text is present", () => {
      const state: InputState = {
        value: "some text",
        cursorIndex: 9,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("c", key, state);

      expect(action).toEqual({ type: "clear" });
    });

    test("exits when input is empty", () => {
      const state: InputState = {
        value: "",
        cursorIndex: 0,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("c", key, state);

      expect(action).toEqual({ type: "exit" });
    });

    test("cancels when disabled (query running)", () => {
      const state: InputState = {
        value: "some text",
        cursorIndex: 9,
        disabled: true,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("c", key, state);

      expect(action).toEqual({ type: "cancel" });
    });

    test("cancels even with empty input when disabled", () => {
      const state: InputState = {
        value: "",
        cursorIndex: 0,
        disabled: true,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("c", key, state);

      expect(action).toEqual({ type: "cancel" });
    });
  });

  describe("Escape key", () => {
    test("cancels query when disabled (tool running)", () => {
      const state: InputState = {
        value: "some input",
        cursorIndex: 10,
        disabled: true,
      };
      const key: KeyEvent = { escape: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({ type: "cancel" });
    });

    test("does nothing when not disabled", () => {
      const state: InputState = {
        value: "some input",
        cursorIndex: 10,
        disabled: false,
      };
      const key: KeyEvent = { escape: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({ type: "none" });
    });
  });

  describe("Ctrl+A (beginning of line)", () => {
    test("moves cursor to start of single line", () => {
      const state: InputState = {
        value: "hello world",
        cursorIndex: 6,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("a", key, state);

      expect(action).toEqual({ type: "set_cursor", cursorIndex: 0 });
    });

    test("moves cursor to start of current line in multiline", () => {
      const state: InputState = {
        value: "line one\nline two",
        cursorIndex: 14, // in "line two"
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("a", key, state);

      expect(action).toEqual({ type: "set_cursor", cursorIndex: 9 }); // start of "line two"
    });
  });

  describe("Ctrl+E (end of line)", () => {
    test("moves cursor to end of single line", () => {
      const state: InputState = {
        value: "hello world",
        cursorIndex: 0,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("e", key, state);

      expect(action).toEqual({ type: "set_cursor", cursorIndex: 11 });
    });

    test("moves cursor to end of current line in multiline", () => {
      const state: InputState = {
        value: "line one\nline two",
        cursorIndex: 2, // in "line one"
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("e", key, state);

      expect(action).toEqual({ type: "set_cursor", cursorIndex: 8 }); // end of "line one"
    });
  });

  describe("Ctrl+K (kill to end of line)", () => {
    test("deletes from cursor to end of line", () => {
      const state: InputState = {
        value: "hello world",
        cursorIndex: 5,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("k", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "hello",
        cursorIndex: 5,
      });
    });

    test("deletes to newline in multiline", () => {
      const state: InputState = {
        value: "line one\nline two",
        cursorIndex: 4,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("k", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "line\nline two",
        cursorIndex: 4,
      });
    });
  });

  describe("Ctrl+U (kill to beginning of line)", () => {
    test("deletes from cursor to beginning of line", () => {
      const state: InputState = {
        value: "hello world",
        cursorIndex: 6,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("u", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "world",
        cursorIndex: 0,
      });
    });
  });

  describe("Ctrl+W (kill word backward)", () => {
    test("deletes previous word", () => {
      const state: InputState = {
        value: "hello world",
        cursorIndex: 11,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("w", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "hello ",
        cursorIndex: 6,
      });
    });

    test("deletes to beginning if no space", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 5,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("w", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "",
        cursorIndex: 0,
      });
    });
  });

  describe("Enter key", () => {
    test("submits on Enter", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 5,
        disabled: false,
      };
      const key: KeyEvent = { return: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({ type: "submit", value: "hello" });
    });

    test("inserts newline on Shift+Enter", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 5,
        disabled: false,
      };
      const key: KeyEvent = { return: true, shift: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "hello\n",
        cursorIndex: 6,
      });
    });

    test("inserts newline at cursor position", () => {
      const state: InputState = {
        value: "hello world",
        cursorIndex: 5,
        disabled: false,
      };
      const key: KeyEvent = { return: true, shift: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "hello\n world",
        cursorIndex: 6,
      });
    });
  });

  describe("Arrow keys", () => {
    test("moves cursor left", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 3,
        disabled: false,
      };
      const key: KeyEvent = { leftArrow: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({ type: "set_cursor", cursorIndex: 2 });
    });

    test("moves cursor right", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 3,
        disabled: false,
      };
      const key: KeyEvent = { rightArrow: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({ type: "set_cursor", cursorIndex: 4 });
    });

    test("does not move cursor left past beginning", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 0,
        disabled: false,
      };
      const key: KeyEvent = { leftArrow: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({ type: "set_cursor", cursorIndex: 0 });
    });

    test("does not move cursor right past end", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 5,
        disabled: false,
      };
      const key: KeyEvent = { rightArrow: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({ type: "set_cursor", cursorIndex: 5 });
    });
  });

  describe("Backspace", () => {
    test("deletes character before cursor", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 3,
        disabled: false,
      };
      const key: KeyEvent = { backspace: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "helo",
        cursorIndex: 2,
      });
    });

    test("does nothing at beginning", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 0,
        disabled: false,
      };
      const key: KeyEvent = { backspace: true };

      const action = processKeyInput("", key, state);

      expect(action).toEqual({ type: "none" });
    });
  });

  describe("Regular character input", () => {
    test("inserts character at cursor", () => {
      const state: InputState = {
        value: "hllo",
        cursorIndex: 1,
        disabled: false,
      };
      const key: KeyEvent = {};

      const action = processKeyInput("e", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "hello",
        cursorIndex: 2,
      });
    });

    test("appends character at end", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 5,
        disabled: false,
      };
      const key: KeyEvent = {};

      const action = processKeyInput("!", key, state);

      expect(action).toEqual({
        type: "set_value",
        value: "hello!",
        cursorIndex: 6,
      });
    });

    test("ignores input with ctrl modifier", () => {
      const state: InputState = {
        value: "hello",
        cursorIndex: 5,
        disabled: false,
      };
      const key: KeyEvent = { ctrl: true };

      const action = processKeyInput("x", key, state);

      expect(action).toEqual({ type: "none" });
    });
  });
});
