import {join} from "node:path";
import type {LunaEditor} from "./index";
import {SEQ} from "../constants";

export function initializeCommands(this: LunaEditor)
{
    this.commands.set(".e", {
        desc: "Exit", usage: "", action: () =>
        {
            process.stdin.setRawMode(false);
            process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
            process.exit(0);
        }
    });
    this.commands.set(".ls", {
        desc: "File tree", usage: ".ls <dir>", action: (arg) =>
        {
            this.fileTreeTargetDir = arg || ".";
            this.fileTreeItems = this.generateTreeData(this.fileTreeTargetDir);
            this.fileTreeIndex = 0;
            this.isViewingFileTree = true;
        }
    });
    this.commands.set(".c", {
        desc: "Clear buffer", usage: "", action: () =>
        {
            this.saveState();
            Object.assign(this, {
                lines:     [""],
                filename:  "",
                cx:        0,
                cy:        0,
                rowOffset: 0,
                colOffset: 0,
                anchorX:   null,
                anchorY:   null,
                history:   [],
                redoStack: []
            });
        }
    });
    this.commands.set(".s", {
        desc: "Save", usage: ".s <path>", action: async (arg) =>
        {
            if (arg) this.filename = arg;
            if (this.filename) await Bun.write(this.filename, this.lines.join("\n")); else this.commandBuffer = "Error: No filename.";
        }
    });
    this.commands.set(".r", {
        desc: "Replace", usage: ".r <target> <rep>", action: (arg) =>
        {
            if (!arg) return;
            const [target, ...rest] = arg.split(" ");
            const idx = this.lines[this.cy].indexOf(target);
            if (idx !== -1)
            {
                this.saveState();
                const line = this.lines[this.cy];
                this.lines[this.cy] = line.slice(0, idx) + rest.join(" ") + line.slice(idx + target.length);
                this.cx = idx;
                this.snapViewport();
            }
        }
    });
    this.commands.set(".o", {
        desc: "Open file", usage: ".o <path>", action: async (arg) =>
        {
            if (arg) await this.openFile(arg);
        }
    });
    this.commands.set(".l", {
        desc: "Go to line", usage: ".l <num>", action: (arg) =>
        {
            const n = parseInt(arg, 10);
            if (!isNaN(n))
            {
                this.cy = Math.max(0, Math.min(n - 1, this.lines.length - 1));
                this.cx = 0;
                this.snapViewport();
            }
        }
    });
    this.commands.set(".h", {
        desc: "Help menu", usage: "", action: () =>
        {
            this.isViewingHelp = true;
        }
    });
    this.commands.set(".t", {
        desc: "Load theme", usage: ".t <name>", action: async (arg) =>
        {
            if (!arg) return;
            const name = arg.endsWith(".json") ? arg : `${arg}.json`;
            const file = Bun.file(join(this.getExtensionsDir(), "themes", name));
            if (await file.exists())
            {
                const {applyTheme} = await import("../renderer/theme");
                applyTheme(await file.json());
            }
        }
    });
    this.commands.set(".f", {
        desc: "Find text", usage: ".f <text>", action: (arg) =>
        {
            if (!arg) return;
            for (let i = this.cy; i < this.lines.length; i++)
            {
                const idx = this.lines[i].indexOf(arg);
                if (idx !== -1 && (i > this.cy || idx > this.cx))
                {
                    this.cy = i;
                    this.cx = idx;
                    this.snapViewport();
                    return;
                }
            }
            for (let i = 0; i <= this.cy; i++)
            {
                const idx = this.lines[i].indexOf(arg);
                if (idx !== -1)
                {
                    this.cy = i;
                    this.cx = idx;
                    this.snapViewport();
                    return;
                }
            }
        }
    });
    this.commands.set(".d", {
        desc: "Delete line", usage: "", action: () =>
        {
            this.saveState();
            this.lines.splice(this.cy, 1);
            if (this.lines.length === 0) this.lines = [""];
            this.cy = Math.max(0, Math.min(this.cy, this.lines.length - 1));
            this.cx = 0;
            this.snapViewport();
        }
    });
    this.commands.set(".rl", {
        desc: "Reload editor", usage: "", action: async () =>
        {
            await this.loadDefaultTheme();
            this.scripts.clear();
            await this.loadScripts();
            this.autocompleteKeywords.clear();
            await this.loadKeywords();
            if (this.filename)
            {
                const ext = this.filename.split(".").pop();
                if (ext)
                {
                    const file = Bun.file(join(this.getExtensionsDir(), "languages", "syntax", `${ext}.json`));
                    if (await file.exists())
                    {
                        const {registerLanguage} = await import("../renderer/syntax");
                        registerLanguage(ext, await file.json());
                    }
                }
            }
            process.stdout.write("\x1b[2J\x1b[H");
            this.refresh();
        }
    });
    this.commands.set(".cl", {
        desc: "Clone line", usage: "", action: () =>
        {
            this.saveState();
            this.lines.splice(this.cy + 1, 0, this.lines[this.cy]);
            this.cy++;
            this.refresh();
        }
    });
    this.commands.set(".run", {
        desc: "Run command/script", usage: ".run <cmd>", action: async (arg) =>
        {
            if (!arg) return;
            const [scriptName, ...scriptArgs] = arg.split(" ");
            let cmd = this.scripts.has(scriptName) ? (scriptArgs.length ? `${this.scripts.get(scriptName)} ${scriptArgs.join(" ")}` : this.scripts.get(scriptName)!) : arg;
            this.isSuspended = true;
            try
            {
                process.stdin.setRawMode(false);
                process.stdout.write("\x1b[?25h\x1b[2J\x1b[H\x1b[1;36m▶ Running: " + cmd + "\x1b[m\n\n");
                const isWin = process.platform === "win32";
                Bun.spawnSync({
                    cmd:    [isWin ? "cmd.exe" : "sh", ...(isWin ? ["/c", cmd] : ["-c", cmd])],
                    stdin:  "inherit",
                    stdout: "inherit",
                    stderr: "inherit"
                });
            }
            catch (e: any)
            {
                process.stdout.write(`\n\x1b[1;31mError: ${e.message}\x1b[m\n`);
            }
            process.stdout.write("\n\n\x1b[1;33m[Press any key to return...]\x1b[m");
            process.stdin.setRawMode(true);
            await new Promise<void>(r => process.stdin.once('data', () => r()));
            process.stdout.write("\x1b[?25l\x1b[2J\x1b[H");
            this.isSuspended = false;
            this.refresh();
        }
    });
}