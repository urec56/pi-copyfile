/**
 * pi-copyfile — copy a project file to your system clipboard from inside pi.
 *
 * Usage: /copyfile <path>
 *   - relative paths resolve against the session cwd (the project dir)
 *   - `~/...` and absolute paths work too
 *
 * Clipboard backends, tried in order:
 *   1. native tool: pbcopy (macOS), wl-copy/xclip/xsel (Linux), Set-Clipboard (Windows)
 *      — content is piped via stdin, so large files are fine
 *   2. OSC 52 terminal escape sequence — works over SSH/mosh in most modern terminals
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_BYTES = 16 * 1024 * 1024; // 16 MiB safety cap

function expandPath(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

/** Native clipboard writers per platform, in fallback order. Content is piped via stdin. */
function nativeCopyCommands(): [string, string[]][] {
	const env = process.env;
	switch (process.platform) {
		case "darwin":
			return [["pbcopy", []]];
		case "linux": {
			const wayland = Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland";
			return wayland
				? [
						["wl-copy", []],
						["xclip", ["-selection", "clipboard"]],
					]
				: [
						["xclip", ["-selection", "clipboard"]],
						["xsel", ["--clipboard", "--input"]],
						["wl-copy", []],
					];
		}
		case "win32":
			return [
				[
					"powershell.exe",
					["-NoProfile", "-NonInteractive", "-Command", "$text = [Console]::In.ReadToEnd(); $text | Set-Clipboard"],
				],
			];
		default:
			return [];
	}
}

/** Ask the terminal itself to set the clipboard (OSC 52), chunked with append mode. */
function copyViaOsc52(text: string): void {
	const b64 = Buffer.from(text, "utf-8").toString("base64");
	const CHUNK = 30_000;
	for (let i = 0; i < b64.length; i += CHUNK) {
		const chunk = b64.slice(i, i + CHUNK);
		process.stdout.write(`\x1b]52;${i === 0 ? "c" : "i"};${chunk}\x07`);
	}
}

/** Try native tools first, then OSC 52. Returns the backend that worked, or "" on failure. */
function copyToClipboard(text: string): string {
	const errors: string[] = [];
	for (const [cmd, args] of nativeCopyCommands()) {
		try {
			const res = spawnSync(cmd, args, { input: text, timeout: 10_000 });
			if (res.error) {
				errors.push(`${cmd}: ${(res.error as NodeJS.ErrnoException).code ?? res.error.message}`);
				continue;
			}
			if (res.status === 0) return cmd;
			const stderr = String(res.stderr ?? "").trim();
			errors.push(`${cmd} exited with code ${res.status}${stderr ? `: ${stderr.split("\n")[0]}` : ""}`);
		} catch (e) {
			errors.push(`${cmd}: ${(e as Error).message}`);
		}
	}
	try {
		copyViaOsc52(text);
		return "OSC 52";
	} catch {
		errors.push("OSC 52 write failed");
	}
	process.stderr.write(`pi-copyfile: ${errors.join("; ")}\n`);
	return "";
}

function completePaths(prefix: string): { value: string; label: string }[] | null {
	try {
		const expanded = expandPath(prefix || "");
		// Relative prefixes stay relative in the input (short, composable); absolute ones stay absolute.
		const baseDir = isAbsolute(expanded)
			? dirname(expanded)
			: prefix && prefix.includes("/")
				? dirname(prefix)
				: ".";
		if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) return null;
		const names = readdirSync(baseDir);
		return names
			.filter((n) => (prefix ? n.startsWith(basenameOfPrefix(prefix)) : true))
			.slice(0, 30)
			.map((n) => {
				let isDir = false;
				try {
					isDir = statSync(join(baseDir, n)).isDirectory();
				} catch {
					/* ignore */
				}
				const value = baseDir === "." ? n : join(baseDir, n);
				return { value: isDir ? `${value}/` : value, label: n };
			});
	} catch {
		return null;
	}
}

function basenameOfPrefix(prefix: string): string {
	const i = prefix.lastIndexOf("/");
	return i === -1 ? prefix : prefix.slice(i + 1);
}

export default function copyfileExtension(pi: ExtensionAPI): void {
	pi.registerCommand("copyfile", {
		description: "Copy a file's contents to your system clipboard (usage: /copyfile <path>)",
		getArgumentCompletions: completePaths,
		handler: async (args, ctx) => {
			const raw = args.trim().replace(/^["']|["']$/g, "");
			if (!raw) {
				ctx.ui.notify("Usage: /copyfile <path>", "warning");
				return;
			}

			const file = resolve(process.cwd(), expandPath(raw));
			let buf: Buffer;
			try {
				if (!existsSync(file)) throw new Error(`no such file: ${raw}`);
				const st = statSync(file);
				if (st.isDirectory()) throw new Error(`${raw} is a directory`);
				if (!st.isFile()) throw new Error(`${raw} is not a regular file`);
				if (st.size > MAX_BYTES) {
					throw new Error(`file too large (${(st.size / 1024 / 1024).toFixed(1)} MiB, limit ${MAX_BYTES / 1024 / 1024} MiB)`);
				}
				buf = readFileSync(file);
			} catch (e) {
				ctx.ui.notify(`copyfile: ${(e as Error).message}`, "error");
				return;
			}

			if (buf.includes(0)) {
				ctx.ui.notify(`${raw}: binary file, not copied`, "warning");
				return;
			}

			const method = copyToClipboard(buf.toString("utf-8"));
			if (method) {
				ctx.ui.notify(`Copied ${file} (${(buf.length / 1024).toFixed(1)} KiB) via ${method}`, "info");
			} else {
				ctx.ui.notify(`copyfile: failed to copy ${raw}, no clipboard backend available`, "error");
			}
		},
	});
}
