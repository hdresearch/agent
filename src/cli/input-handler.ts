// Input handling logic extracted for testability

export interface KeyEvent {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  tab?: boolean;
  return?: boolean;
  escape?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

export interface InputState {
  value: string;
  cursorIndex: number;
  disabled: boolean;
}

export type InputAction =
  | { type: "none" }
  | { type: "set_value"; value: string; cursorIndex: number }
  | { type: "set_cursor"; cursorIndex: number }
  | { type: "submit"; value: string }
  | { type: "cancel" }
  | { type: "exit" }
  | { type: "clear" };

/**
 * Process a key input and return the action to take.
 * This is a pure function for easy testing.
 */
export function processKeyInput(
  char: string,
  key: KeyEvent,
  state: InputState
): InputAction {
  const { value, cursorIndex, disabled } = state;

  // Handle Ctrl key combinations
  if (key.ctrl) {
    switch (char) {
      case "a": {
        // Ctrl+A: Beginning of line
        const lineStart = value.lastIndexOf("\n", cursorIndex - 1) + 1;
        return { type: "set_cursor", cursorIndex: lineStart };
      }
      case "e": {
        // Ctrl+E: End of line
        const lineEnd = value.indexOf("\n", cursorIndex);
        return { type: "set_cursor", cursorIndex: lineEnd === -1 ? value.length : lineEnd };
      }
      case "k": {
        // Ctrl+K: Kill to end of line
        const lineEnd = value.indexOf("\n", cursorIndex);
        const newValue = lineEnd === -1
          ? value.slice(0, cursorIndex)
          : value.slice(0, cursorIndex) + value.slice(lineEnd);
        return { type: "set_value", value: newValue, cursorIndex };
      }
      case "u": {
        // Ctrl+U: Kill to beginning of line
        const lineStart = value.lastIndexOf("\n", cursorIndex - 1) + 1;
        const newValue = value.slice(0, lineStart) + value.slice(cursorIndex);
        return { type: "set_value", value: newValue, cursorIndex: lineStart };
      }
      case "w": {
        // Ctrl+W: Kill word backward
        const before = value.slice(0, cursorIndex);
        const trimmed = before.trimEnd();
        const lastSpace = trimmed.lastIndexOf(" ");
        const newPos = lastSpace === -1 ? 0 : lastSpace + 1;
        const newValue = value.slice(0, newPos) + value.slice(cursorIndex);
        return { type: "set_value", value: newValue, cursorIndex: newPos };
      }
      case "c": {
        // Ctrl+C: cancel query, clear input, or exit
        if (disabled) {
          // Query is running - cancel it
          return { type: "cancel" };
        } else if (value.length > 0) {
          // Has input - clear it
          return { type: "clear" };
        } else {
          // No input - exit
          return { type: "exit" };
        }
      }
    }
  }

  // Newline on Shift+Enter
  if (key.return && key.shift) {
    const newValue = value.slice(0, cursorIndex) + "\n" + value.slice(cursorIndex);
    return { type: "set_value", value: newValue, cursorIndex: cursorIndex + 1 };
  }

  // Submit on Enter (without shift)
  if (key.return) {
    return { type: "submit", value };
  }

  // Arrow key navigation (simplified - full impl would need line calculation)
  if (key.leftArrow) {
    return { type: "set_cursor", cursorIndex: Math.max(0, cursorIndex - 1) };
  }
  if (key.rightArrow) {
    return { type: "set_cursor", cursorIndex: Math.min(value.length, cursorIndex + 1) };
  }

  // Backspace
  if (key.backspace || key.delete) {
    if (cursorIndex > 0) {
      const newValue = value.slice(0, cursorIndex - 1) + value.slice(cursorIndex);
      return { type: "set_value", value: newValue, cursorIndex: cursorIndex - 1 };
    }
    return { type: "none" };
  }

  // Regular character input
  if (char && !key.ctrl && !key.meta && !key.tab) {
    const newValue = value.slice(0, cursorIndex) + char + value.slice(cursorIndex);
    return { type: "set_value", value: newValue, cursorIndex: cursorIndex + char.length };
  }

  return { type: "none" };
}
