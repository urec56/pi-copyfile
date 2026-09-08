# pi-copyfile

Copy project files to your system clipboard from inside pi — no need to leave the terminal or open an editor.

## Install

```bash
pi install git:github.com/urec56/pi-copyfile
```

## Usage

```
/copyfile <path>
```

- relative paths resolve against the session cwd (your project dir); `~/...` and absolute paths work too;
- Tab completion for path arguments;
- binary files are not copied (you get a warning instead);
- 16 MiB per-file size guard.

## How copying works

1. Native tool per platform: `pbcopy` (macOS), `wl-copy`/`xclip`/`xsel` (Linux, order depends on Wayland/X11), PowerShell `Set-Clipboard` (Windows). Content is piped via stdin — large files are fine.
2. Fallback: OSC 52 terminal escape sequence (the terminal itself sets the clipboard) — works over SSH/mosh in modern terminals (iTerm2, Kitty, Alacritty, WezTerm, foot, Windows Terminal; tmux with `set-clipboard on`).

On success pi shows a notification like:
`Copied /path/to/file.ts (12.3 KiB) via xclip`.

## License

[MIT](./LICENSE) — Copyright (c) 2026 urec56.
