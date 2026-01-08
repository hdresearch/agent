# libghostty-vt Usage Guide

Zero-dependency terminal parser extracted from Ghostty.

## Quick Start

```bash
# Clone and build
git clone --depth 1 https://github.com/ghostty-org/ghostty.git /tmp/ghostty
cd /tmp/ghostty
zig build lib-vt           # Build the library
zig build test-lib-vt      # Run tests (2826 tests)
```

## Built Artifacts

```
zig-out/
├── lib/
│   └── libghostty-vt.dylib
├── include/ghostty/
│   ├── vt.h              # Main header
│   └── vt/
│       ├── osc.h         # OSC parser
│       ├── sgr.h         # SGR (colors/styles) parser  
│       ├── key.h         # Key encoding
│       └── paste.h       # Paste safety
└── share/pkgconfig/
    └── libghostty-vt.pc
```

## C API Examples

### OSC Parser (window title, clipboard, etc.)

```c
#include <ghostty/vt.h>

int main() {
    GhosttyOscParser parser;
    ghostty_osc_new(NULL, &parser);
    
    // Parse: OSC 0 ; hello BEL  (set window title)
    ghostty_osc_next(parser, '0');
    ghostty_osc_next(parser, ';');
    for (const char *p = "hello"; *p; p++)
        ghostty_osc_next(parser, *p);
    
    GhosttyOscCommand cmd = ghostty_osc_end(parser, 0x07);
    
    if (ghostty_osc_command_type(cmd) == GHOSTTY_OSC_COMMAND_CHANGE_WINDOW_TITLE) {
        const char *title;
        ghostty_osc_command_data(cmd, GHOSTTY_OSC_DATA_CHANGE_WINDOW_TITLE_STR, &title);
        printf("Title: %s\n", title);  // "hello"
    }
    
    ghostty_osc_free(parser);
}
```

### SGR Parser (colors, underline, bold, etc.)

```c
#include <ghostty/vt.h>

int main() {
    GhosttySgrParser parser;
    ghostty_sgr_new(NULL, &parser);
    
    // Parse: ESC[4:3;38;2;255;0;0m (curly underline + red foreground)
    uint16_t params[] = {4, 3, 38, 2, 255, 0, 0};
    char seps[] = ":;;;;;";
    ghostty_sgr_set_params(parser, params, seps, 7);
    
    GhosttySgrAttribute attr;
    while (ghostty_sgr_next(parser, &attr)) {
        switch (attr.tag) {
            case GHOSTTY_SGR_ATTR_UNDERLINE:
                printf("Underline: %d\n", attr.value.underline);
                break;
            case GHOSTTY_SGR_ATTR_DIRECT_COLOR_FG:
                printf("FG RGB: %d,%d,%d\n", 
                    attr.value.direct_color_fg.r,
                    attr.value.direct_color_fg.g,
                    attr.value.direct_color_fg.b);
                break;
        }
    }
    
    ghostty_sgr_free(parser);
}
```

## Compile

```bash
clang -o demo demo.c \
    -I /tmp/ghostty/zig-out/include \
    -L /tmp/ghostty/zig-out/lib \
    -lghostty-vt \
    -Wl,-rpath,/tmp/ghostty/zig-out/lib
```

## OSC Command Types

| Type | Code | Description |
|------|------|-------------|
| `CHANGE_WINDOW_TITLE` | 1 | OSC 0/2 - Set window title |
| `CLIPBOARD_CONTENTS` | 7 | OSC 52 - Clipboard access |
| `REPORT_PWD` | 8 | OSC 7 - Current directory |
| `HYPERLINK_START` | 13 | OSC 8 - Hyperlink |
| `SHOW_DESKTOP_NOTIFICATION` | 12 | OSC 9/777 - Notifications |

## SGR Attribute Types

| Attribute | Description |
|-----------|-------------|
| `BOLD`, `ITALIC`, `UNDERLINE` | Text styles |
| `FG_8`, `BG_8` | 8-color palette |
| `FG_256`, `BG_256` | 256-color palette |
| `DIRECT_COLOR_FG`, `DIRECT_COLOR_BG` | 24-bit RGB |
| `UNDERLINE_COLOR` | Colored underlines |

## Integration with vers-agent

```bash
# From vers-agent root
just gvt  # Interactive VT test harness
```

The `just gvt` command provides interactive testing for all VT sequences that libghostty-vt can parse.

---

*Library: /tmp/ghostty/zig-out/lib/libghostty-vt.dylib*
*Tests: 2826 passed, 26 skipped*
