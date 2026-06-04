import { EditorMode } from "./types";
import { Renderer } from "./renderer";

import { readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";

interface FileTreeItem {
    path: string;
    prefix: string;
    name: string;
    isDir: boolean;
}

const KEY = {
    CTRL_A: 0x01,
    CTRL_C: 0x03,
    CTRL_Q: 0x11,
    CTRL_V: 0x16,
    CTRL_X: 0x18,
    CTRL_Y: 0x19,
    CTRL_Z: 0x1a,
    ESC: 0x1b,
    CR: 0x0d,
    LF: 0x0a,
    BS: 0x08,
    DEL: 0x7f,
    TAB: 0x09
};

const SEQ = {
    CLEAR: "\x1b[2J\x1b[H",
    SHIFT_UP: "\x1b[1;2A",
    SHIFT_DOWN: "\x1b[1;2B",
    SHIFT_RIGHT: "\x1b[1;2C",
    SHIFT_LEFT: "\x1b[1;2D",
    UP: "\x1b[A",
    DOWN: "\x1b[B",
    RIGHT: "\x1b[C",
    LEFT: "\x1b[D"
};

export class LunaEditor
{
    private lines: string[] = [""];
    private cx = 0;
    private cy = 0;
    private rowOffset = 0;
    private colOffset = 0;
    private filename = "";
    private mode: EditorMode = "insert";
    private commandBuffer = "";
    private isViewingHelp = false;
    private isViewingFileTree = false;
    private fileTreeTargetDir = ".";
    private fileTreeItems: FileTreeItem[] = [];
    private fileTreeIndex = 0;
    private anchorX: number | null = null;
    private anchorY: number | null = null;
    private clipboard = "";

    private history: Array<{ lines: string[]; cx: number; cy: number }> = [];
    private redoStack: Array<{ lines: string[]; cx: number; cy: number }> = [];

    private lastSearchText: string = "";
    private autocompleteIndex: number = -1;

    private fileTreeScrollOffset = 0;

    private pathAutocompleteMatches: string[] = [];
    private pathAutocompleteIndex: number = -1;
    private lastPathAutocompleteArg: string = "";

    private commands = new Map<string, { desc: string; usage: string, action: (arg: string) => Promise<void> | void }>();

    constructor()
    {
        this.initializeCommands();
        this.setupTerminal();
        this.loadDefaultTheme();
        this.refresh();
    }

    private saveState()
    {
        if (this.history.length > 200)
        {
            this.history.shift();
        }
        this.history.push({
            lines: [...this.lines],
            cx: this.cx,
            cy: this.cy
        });
        this.redoStack = [];
    }

    private undo()
    {
        if (this.history.length > 0)
        {
            const previous = this.history.pop()!;
            this.redoStack.push({
                lines: [...this.lines],
                cx: this.cx,
                cy: this.cy
            });
            this.lines = previous.lines;
            this.cx = previous.cx;
            this.cy = previous.cy;
            this.snapViewport();
            this.refresh();
        }
    }

    private redo()
    {
        if (this.redoStack.length > 0)
        {
            const next = this.redoStack.pop()!;
            this.history.push({
                lines: [...this.lines],
                cx: this.cx,
                cy: this.cy
            });
            this.lines = next.lines;
            this.cx = next.cx;
            this.cy = next.cy;
            this.snapViewport();
            this.refresh();
        }
    }

    private snapViewport()
    {
        const rows = process.stdout.rows || 24;
        const cols = process.stdout.columns || 80;
        const visibleRows = rows - 1;
        const visibleCols = cols - 7;

        if (this.cy < this.rowOffset)
        {
            this.rowOffset = this.cy;
        }
        else if (this.cy >= this.rowOffset + visibleRows)
        {
            this.rowOffset = this.cy - visibleRows + 1;
        }

        if (this.cx < this.colOffset)
        {
            this.colOffset = this.cx;
        }
        else if (this.cx >= this.colOffset + visibleCols)
        {
            this.colOffset = this.cx - visibleCols + 1;
        }
    }

    private getSelectionRange()
    {
        if (this.anchorX === null || this.anchorY === null) return null;

        const forward = this.anchorY < this.cy || (this.anchorY === this.cy && this.anchorX <= this.cx);
        return forward
            ? { sy: this.anchorY, sx: this.anchorX, ey: this.cy, ex: this.cx }
            : { sy: this.cy, sx: this.cx, ey: this.anchorY, ex: this.anchorX };
    }

    private async loadDefaultTheme()
    {
        const defaultThemePath = `${import.meta.dir}/extensions/themes/luna.json`;
        const file = Bun.file(defaultThemePath);
        if (await file.exists())
        {
            const content = await file.json();
            const { applyTheme } = await import("./renderer");
            applyTheme(content);
            this.refresh();
        }
    }

    private generateTreeData(dir: string, prefix = ""): FileTreeItem[]
    {
        let results: FileTreeItem[] = [];
        try
        {
            const items = readdirSync(dir).filter(item => item !== "node_modules" && item !== ".git" && item !== ".bun-cache");
            items.sort((a, b) => a.localeCompare(b));

            for (let i = 0; i < items.length; i++)
            {
                const item = items[i];
                const path = join(dir, item);
                const isLast = i === items.length - 1;
                const marker = isLast ? "└── " : "├── ";

                let isDir = false;
                try
                {
                    isDir = statSync(path).isDirectory();
                }
                catch
                {
                }

                results.push({
                    path,
                    prefix: prefix + marker,
                    name: item + (isDir ? "/" : ""),
                    isDir
                });

                if (isDir)
                {
                    const newPrefix = prefix + (isLast ? "    " : "│   ");
                    results.push(...this.generateTreeData(path, newPrefix));
                }
            }
        }
        catch
        {
            results.push({ path: dir, prefix: prefix, name: "└── [Error reading directory]", isDir: false });
        }
        return results;
    }

    private initializeCommands()
    {
        this.commands.set(".e", {
            desc: "Exit the editor",
            usage : "",
            action: () => {
                process.stdout.write(SEQ.CLEAR);
                process.exit();
            }
        });

        this.commands.set(".ls", {
            desc: "Display the interactive file tree",
            usage: ".ls or .ls <dir>",
            action: (arg) => {
                this.fileTreeTargetDir = arg || ".";
                this.fileTreeItems = this.generateTreeData(this.fileTreeTargetDir);
                this.fileTreeIndex = 0;
                this.isViewingFileTree = true;
            }
        });

        this.commands.set(".c", {
            desc: "Clear the current text buffer and close file",
            usage : "",
            action: () => {
                this.saveState();
                this.lines = [""];
                this.filename = "";
                this.cx = 0;
                this.cy = 0;
                this.rowOffset = 0;
                this.colOffset = 0;
                this.anchorX = null;
                this.anchorY = null;
                this.history = [];
                this.redoStack = [];
            }
        });

        this.commands.set(".s", {
            desc: "Save buffer to disk",
            usage : ".s or .s <path>",
            action: async (arg) => {
                if (arg)
                {
                    this.filename = arg;
                }

                if (this.filename)
                {
                    await Bun.write(this.filename, this.lines.join("\n"));
                }
                else
                {
                    this.commandBuffer = "Error: No filename specified. Use '.s <path>'";
                }
            }
        });

        this.commands.set(".r", {
            desc: "Replace first occurrence on current line",
            usage : ".r <target> <replacement>",
            action: (arg) => {
                if (!arg) return;
                const parts = arg.split(" ");
                if (parts.length < 2) return;
                const target = parts[0];
                const replacement = parts.slice(1).join(" ");
                const line = this.lines[this.cy];
                const idx = line.indexOf(target);
                if (idx !== -1)
                {
                    this.saveState();
                    this.lines[this.cy] = line.slice(0, idx) + replacement + line.slice(idx + target.length);
                    this.cx = idx;
                    this.snapViewport();
                }
            }
        });

        this.commands.set(".o", {
            desc: "Open a file path from disk",
            usage : ".o <path>",
            action: async (arg) => {
                if (arg)
                {
                    await this.openFile(arg);
                }
            }
        });

        this.commands.set(".l", {
            desc: "Jump directly to a line number",
            usage: ".l <number>",
            action: (arg) => {
                const lineNum = parseInt(arg, 10);
                if (!isNaN(lineNum))
                {
                    const targetLine = lineNum - 1;
                    this.cy = Math.max(0, Math.min(targetLine, this.lines.length - 1));
                    this.cx = 0;
                    this.snapViewport();
                }
            }
        });

        this.commands.set(".h", {
            desc: "Display this interactive help menu",
            usage: "",
            action: () => {
                this.isViewingHelp = true;
            }
        });

        this.commands.set(".t", {
            desc: "Load a theme from the extensions folder",
            usage: ".t <name>",
            action: async (arg) => {
                if (arg)
                {
                    const name = arg.endsWith(".json") ? arg : `${arg}.json`;
                    const themePath = `${import.meta.dir}/extensions/themes/${name}`;
                    const file = Bun.file(themePath);
                    if (await file.exists())
                    {
                        const content = await file.json();
                        const { applyTheme } = await import("./renderer");
                        applyTheme(content);
                    }
                }
            }
        });

        this.commands.set(".f", {
            desc: "Find text in the file",
            usage: ".f <text>",
            action: (arg) => {
                if (!arg) return;

                let found = false;
                for (let i = this.cy; i < this.lines.length; i++) {
                    const idx = this.lines[i].indexOf(arg);
                    if (idx !== -1 && (i > this.cy || idx > this.cx)) {
                        this.cy = i;
                        this.cx = idx;
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    for (let i = 0; i <= this.cy; i++) {
                        const idx = this.lines[i].indexOf(arg);
                        if (idx !== -1) {
                            this.cy = i;
                            this.cx = idx;
                            break;
                        }
                    }
                }
                this.snapViewport();
            }
        });

        this.commands.set(".d", {
            desc: "Delete the entire current line",
            usage : "",
            action: () => {
                this.saveState();
                this.lines.splice(this.cy, 1);
                if (this.lines.length === 0) {
                    this.lines = [""];
                }
                this.cy = Math.max(0, Math.min(this.cy, this.lines.length - 1));
                this.cx = 0;
                this.snapViewport();
            }
        });
        this.commands.set(".rtl", {
            desc: "Reload themes and language extensions",
            usage: "",
            action: async () => {
                await this.loadDefaultTheme();

                if (this.filename) {
                    const ext = this.filename.split(".").pop();
                    if (ext) {
                        const langPath = `${import.meta.dir}/extensions/languages/${ext}.json`;
                        const langFile = Bun.file(langPath);
                        if (await langFile.exists()) {
                            const rules = await langFile.json();
                            const { registerLanguage } = await import("./renderer");
                            registerLanguage(ext, rules);
                        }
                    }
                }
                this.refresh();
            }
        });
    }

    private setupTerminal()
    {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", (data) => {
            const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
            this.handleRawInput(buffer);
        });
        process.stdout.on("resize", () => {
            this.snapViewport();
            this.refresh();
        });
    }

    private refresh()
    {
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 24;
        let commandUsage = "";
        if (this.mode === "command" && this.commandBuffer.trim().length > 0)
        {
            const segments = this.commandBuffer.trim().split(";");
            const activeSegment = segments[segments.length - 1].trim();
            const baseCmd = activeSegment.split(" ")[0];
            const cmd = this.commands.get(baseCmd);
            if (cmd)
            {
                commandUsage = cmd.usage;
            }
        }

        if (this.isViewingHelp)
        {
            const helpLines: string[] = ["--- COMMANDS CHEATSHEET ---", ""];
            for (const [name, cmd] of this.commands.entries())
            {
                const nameColumn = name.padEnd(8, " ");
                const descColumn = cmd.desc.padEnd(45, " ");

                helpLines.push(`${nameColumn} : ${descColumn} | ${cmd.usage}`);
            }
            helpLines.push("");
            helpLines.push("Press any key to close this menu...");
            Renderer.render(helpLines, 0, 0, 0, 0, this.mode, "Help System", this.commandBuffer, null, commandUsage);
        }
        else if (this.isViewingFileTree)
        {
            const headerText = `--- File Tree : ${this.fileTreeTargetDir} ---`;
            const headerPadding = Math.max(0, Math.floor((cols - headerText.length) / 2));
            const treeLines: string[] = [
                " ".repeat(headerPadding) + headerText,
                ""
            ];

            const visibleHeight = rows - 5;
            const end = Math.min(this.fileTreeScrollOffset + visibleHeight, this.fileTreeItems.length);

            for (let i = this.fileTreeScrollOffset; i < end; i++)
            {
                const item = this.fileTreeItems[i];
                if (i === this.fileTreeIndex)
                {
                    treeLines.push(`\x1b[7m${item.prefix}${item.name}\x1b[m`);
                }
                else
                {
                    const colorCode = item.isDir ? "\x1b[1;36m" : "\x1b[32m";
                    treeLines.push(`${item.prefix}${colorCode}${item.name}\x1b[0m`);
                }
            }

            const currentLength = treeLines.length;
            const targetLength = rows - 2;
            if (currentLength < targetLength)
            {
                for (let i = 0; i < (targetLength - currentLength); i++)
                {
                    treeLines.push("");
                }
            }

            const navText = "▲/▼: Navigate | ENTER: Select File | ESC: Cancel";
            const navPadding = Math.max(0, Math.floor((cols - navText.length) / 2));
            treeLines.push(" ".repeat(navPadding) + navText);

            Renderer.render(treeLines, 0, 0, 0, 0, this.mode, "File Explorer", this.commandBuffer, null, commandUsage);
        }
        else
        {
            Renderer.render(this.lines, this.cx, this.cy, this.rowOffset, this.colOffset, this.mode, this.filename, this.commandBuffer, this.getSelectionRange(), commandUsage);
        }
    }

    private writeToSystemClipboard(text: string)
    {
        try
        {
            if (process.platform === "darwin")
            {
                Bun.spawnSync({ cmd: ["pbcopy"], stdin: Buffer.from(text) });
            }
            else if (process.platform === "win32")
            {
                Bun.spawnSync({ cmd: ["clip"], stdin: Buffer.from(text) });
            }
            else if (process.platform === "linux")
            {
                Bun.spawnSync({ cmd: ["xclip", "-selection", "clipboard"], stdin: Buffer.from(text) });
            }
        }
        catch
        {
        }
    }

    public async openFile(path: string)
    {
        this.filename = path;
        const file = Bun.file(path);
        if (await file.exists())
        {
            const content = await file.text();
            this.lines = content.split("\n");
            if (this.lines.length === 0) this.lines = [""];

            const ext = path.split(".").pop();
            if (ext)
            {
                const langPath = `${import.meta.dir}/extensions/languages/${ext}.json`;
                const langFile = Bun.file(langPath);
                if (await langFile.exists())
                {
                    const rules = await langFile.json();
                    const { registerLanguage } = await import("./renderer");
                    registerLanguage(ext, rules);
                }
            }
        }
        else
        {
            this.lines = [""];
        }
        this.cx = 0;
        this.cy = 0;
        this.rowOffset = 0;
        this.colOffset = 0;
        this.history = [];
        this.redoStack = [];
        this.refresh();
    }

    private async handleRawInput(data: Buffer)
    {
        const str = data.toString();
        const key = data[0];

        if (this.isViewingHelp)
        {
            this.isViewingHelp = false;
            this.commandBuffer = "";
            this.refresh();
            return;
        }

        if (this.isViewingFileTree)
        {
            const visibleHeight = process.stdout.rows - 5;

            if (str === SEQ.UP) {
                if (this.fileTreeIndex > 0) {
                    this.fileTreeIndex--;
                    if (this.fileTreeIndex < this.fileTreeScrollOffset) {
                        this.fileTreeScrollOffset = this.fileTreeIndex;
                    }
                }
                this.refresh();
                return;
            }

            if (str === SEQ.DOWN) {
                if (this.fileTreeIndex < this.fileTreeItems.length - 1) {
                    this.fileTreeIndex++;
                    if (this.fileTreeIndex >= this.fileTreeScrollOffset + visibleHeight) {
                        this.fileTreeScrollOffset++;
                    }
                }
                this.refresh();
                return;
            }
            if (key === KEY.CR || key === KEY.LF)
            {
                const selected = this.fileTreeItems[this.fileTreeIndex];
                if (selected && !selected.isDir)
                {
                    this.isViewingFileTree = false;
                    await this.openFile(selected.path);
                }
                return;
            }
            if (key === KEY.ESC || key === KEY.CTRL_Q)
            {
                this.isViewingFileTree = false;
                this.refresh();
                return;
            }
            return;
        }

        if (data.length === 1)
        {
            if (key === KEY.CTRL_Q)
            {
                process.stdout.write(SEQ.CLEAR);
                process.exit();
            }
            if (key === KEY.CTRL_Z)
            {
                this.undo();
                return;
            }
            if (key === KEY.CTRL_Y)
            {
                this.redo();
                return;
            }
            if (key === KEY.CTRL_A)
            {
                this.anchorX = 0;
                this.anchorY = 0;
                this.cy = this.lines.length - 1;
                this.cx = this.lines[this.cy].length;
                this.snapViewport();
                this.refresh();
                return;
            }
            if (key === KEY.CTRL_C)
            {
                const range = this.getSelectionRange();
                if (range)
                {
                    const selectedText: string[] = [];
                    if (range.sy === range.ey)
                    {
                        selectedText.push(this.lines[range.sy].slice(range.sx, range.ex));
                    }
                    else
                    {
                        selectedText.push(this.lines[range.sy].slice(range.sx));
                        for (let i = range.sy + 1; i < range.ey; i++) selectedText.push(this.lines[i]);
                        selectedText.push(this.lines[range.ey].slice(0, range.ex));
                    }
                    const compiledText = selectedText.join("\n");
                    this.clipboard = compiledText;
                    this.writeToSystemClipboard(compiledText);
                    this.anchorX = null;
                    this.anchorY = null;
                    this.refresh();
                }
                else
                {
                    process.stdout.write(SEQ.CLEAR);
                    process.exit();
                }
                return;
            }
            if (key === KEY.CTRL_X)
            {
                const range = this.getSelectionRange();
                if (range)
                {
                    this.saveState();
                    const selectedText: string[] = [];
                    if (range.sy === range.ey)
                    {
                        selectedText.push(this.lines[range.sy].slice(range.sx, range.ex));
                        this.lines[range.sy] = this.lines[range.sy].slice(0, range.sx) + this.lines[range.sy].slice(range.ex);
                    }
                    else
                    {
                        selectedText.push(this.lines[range.sy].slice(range.sx));
                        const first = this.lines[range.sy].slice(0, range.sx);
                        const last = this.lines[range.ey].slice(range.ex);
                        for (let i = range.sy + 1; i < range.ey; i++) selectedText.push(this.lines[i]);
                        selectedText.push(this.lines[range.ey].slice(0, range.ex));
                        this.lines[range.sy] = first + last;
                        this.lines.splice(range.sy + 1, range.ey - range.sy);
                    }
                    const compiledText = selectedText.join("\n");
                    this.clipboard = compiledText;
                    this.writeToSystemClipboard(compiledText);
                    this.cx = range.sx;
                    this.cy = range.sy;
                    this.anchorX = null;
                    this.anchorY = null;
                    this.snapViewport();
                    this.refresh();
                }
                return;
            }
            if (key === KEY.CTRL_V)
            {
                if (this.clipboard)
                {
                    this.saveState();
                    this.anchorX = null;
                    this.anchorY = null;
                    const clipLines = this.clipboard.split("\n");
                    if (clipLines.length === 1)
                    {
                        this.lines[this.cy] = this.lines[this.cy].slice(0, this.cx) + clipLines[0] + this.lines[this.cy].slice(this.cx);
                        this.cx += clipLines[0].length;
                    }
                    else
                    {
                        const before = this.lines[this.cy].slice(0, this.cx);
                        const after = this.lines[this.cy].slice(this.cx);
                        const first = before + clipLines[0];
                        const last = clipLines[clipLines.length - 1] + after;
                        const middle = clipLines.slice(1, -1);
                        this.lines.splice(this.cy, 1, first, ...middle, last);
                        this.cy += clipLines.length - 1;
                        this.cx = clipLines[clipLines.length - 1].length;
                    }
                    this.snapViewport();
                    this.refresh();
                }
                return;
            }
        }

        const isShiftArrow = str === SEQ.SHIFT_UP || str === SEQ.SHIFT_DOWN || str === SEQ.SHIFT_RIGHT || str === SEQ.SHIFT_LEFT;
        const isNormalArrow = str === SEQ.UP || str === SEQ.DOWN || str === SEQ.LEFT || str === SEQ.RIGHT;

        if (isShiftArrow || isNormalArrow)
        {
            if (isShiftArrow && this.anchorX === null)
            {
                this.anchorX = this.cx;
                this.anchorY = this.cy;
            }
            else if (isNormalArrow)
            {
                this.anchorX = null;
                this.anchorY = null;
            }

            if (str === SEQ.UP || str === SEQ.SHIFT_UP)
            {
                if (this.cy > 0)
                {
                    this.cy--;
                }
            }
            else if (str === SEQ.DOWN || str === SEQ.SHIFT_DOWN)
            {
                if (this.cy < this.lines.length - 1)
                {
                    this.cy++;
                }
            }
            else if (str === SEQ.LEFT || str === SEQ.SHIFT_LEFT)
            {
                if (this.cx > 0)
                {
                    this.cx--;
                }
                else if (this.cy > 0)
                {
                    this.cy--;
                    this.cx = this.lines[this.cy].length;
                }
            }
            else if (str === SEQ.RIGHT || str === SEQ.SHIFT_RIGHT)
            {
                if (this.cx < this.lines[this.cy].length)
                {
                    this.cx++;
                }
                else if (this.cy < this.lines.length - 1)
                {
                    this.cy++;
                    this.cx = 0;
                }
            }
            this.snapViewport();
            this.refresh();
            return;
        }

        if (data.length === 1 && key === KEY.ESC)
        {
            this.mode = this.mode === "insert" ? "command" : "insert";
            this.commandBuffer = "";
            this.anchorX = null;
            this.anchorY = null;
            this.refresh();
            return;
        }

        if (!isShiftArrow && key !== KEY.CTRL_A && key !== KEY.CTRL_C && key !== KEY.CTRL_V && key !== KEY.CTRL_X)
        {
            this.anchorX = null;
            this.anchorY = null;
        }

        if (this.mode === "command")
        {
            await this.handleCommandInput(data);
        }
        else
        {
            this.handleInsertInput(data);
        }
    }

    private async handleCommandInput(data: Buffer)
    {
        const str = data.toString();

        if (data[0] === KEY.CR || data[0] === KEY.LF)
        {
            const fullBuffer = this.commandBuffer.trim();
            this.commandBuffer = "";
            this.autocompleteIndex = -1;
            this.lastSearchText = "";

            const commandsToRun = fullBuffer.split(";").map(c => c.trim()).filter(c => c.length > 0);
            for (const sequentialCmd of commandsToRun)
            {
                await this.executeCommand(sequentialCmd);
            }
            this.mode = "insert";
        }
        else if (data[0] === KEY.TAB)
        {
            const trimmed = this.commandBuffer.trim();
            const parts = trimmed.split(/\s+/);
            const cmd = parts[0];

            const pathCommands = [".o", ".s", ".t", ".ls"];

            if (pathCommands.includes(cmd) && parts.length > 1) {
                const lastSpaceIndex = this.commandBuffer.lastIndexOf(" ");
                const currentArg = this.commandBuffer.substring(lastSpaceIndex + 1);
                const baseName = basename(currentArg);

                let actualDir: string;
                const isThemeCommand = cmd === ".t";
                const themesBase = `${import.meta.dir}/extensions/themes`;
                
                if (isThemeCommand) {
                    actualDir = themesBase;
                } else {
                    const dirPart = dirname(currentArg);
                    actualDir = dirPart === "." ? process.cwd() : dirPart;
                }

                if (this.lastPathAutocompleteArg !== currentArg || this.pathAutocompleteMatches.length === 0) {
                    this.lastPathAutocompleteArg = currentArg;
                    this.pathAutocompleteIndex = -1;

                    try {
                        const items = readdirSync(actualDir);
                        this.pathAutocompleteMatches = items
                            .filter(item => item.startsWith(baseName))
                            .map(item => {
                                const fullPath = join(actualDir, item);
                                try {
                                    const isDir = statSync(fullPath).isDirectory();
                                    if (isDir) return item + "/";

                                    if (isThemeCommand && item.endsWith(".json")) {
                                        return item.slice(0, -5);
                                    }
                                    return item;
                                } catch {
                                    return item;
                                }
                            });
                    } catch {
                        this.pathAutocompleteMatches = [];
                    }
                }

                if (this.pathAutocompleteMatches.length > 0) {
                    this.pathAutocompleteIndex = (this.pathAutocompleteIndex + 1) % this.pathAutocompleteMatches.length;
                    const match = this.pathAutocompleteMatches[this.pathAutocompleteIndex];

                    let newArg: string;
                    if (isThemeCommand) {
                        // For themes, use the clean name
                        newArg = match;
                    } else {
                        // For normal files, reconstruct the path and normalize to forward slashes
                        const dirPart = dirname(currentArg);
                        newArg = dirPart === "." ? match : join(dirPart, match).replace(/\\/g, "/");
                    }

                    const beforeArg = this.commandBuffer.substring(0, lastSpaceIndex + 1);
                    this.commandBuffer = beforeArg + newArg;
                }
            }
            else {
                if (this.autocompleteIndex === -1) {
                    this.lastSearchText = this.commandBuffer;
                }
                const availableCommands = Array.from(this.commands.keys());
                const matches = availableCommands.filter(c => c.startsWith(this.lastSearchText));
                if (matches.length > 0) {
                    this.autocompleteIndex = (this.autocompleteIndex + 1) % matches.length;
                    this.commandBuffer = matches[this.autocompleteIndex];
                }
            }
        }
        else if (data[0] === KEY.DEL || data[0] === KEY.BS)
        {
            if (this.commandBuffer.length > 0)
            {
                this.commandBuffer = this.commandBuffer.slice(0, -1);
            }
            this.autocompleteIndex = -1;
            this.lastSearchText = "";
        }
        else if (data[0] >= 32 && data[0] !== KEY.ESC)
        {
            this.commandBuffer += str;
            this.autocompleteIndex = -1;
            this.lastSearchText = "";
        }

        this.refresh();
    }

    private async executeCommand(cmd: string)
    {
        const parts = cmd.split(" ");
        const baseCmd = parts[0];
        const arg = parts.slice(1).join(" ").trim();

        const command = this.commands.get(baseCmd);
        if (command)
        {
            await command.action(arg);
        }
    }

    private handleInsertInput(data: Buffer)
    {
        const str = data.toString();

        if (data[0] === KEY.CR || data[0] === KEY.LF)
        {
            this.saveState();
            const currentLine = this.lines[this.cy];
            const textBeforeCursor = currentLine.slice(0, this.cx);
            const rem = currentLine.slice(this.cx);

            const indentMatch = textBeforeCursor.match(/^\s*/);
            const baseIndent = indentMatch ? indentMatch[0] : "";
            let indent = baseIndent;

            if (textBeforeCursor.trim().endsWith("{") || textBeforeCursor.trim().endsWith("[") || textBeforeCursor.trim().endsWith("("))
            {
                indent += "    ";
            }

            const isPairExplosion =
                (textBeforeCursor.trim().endsWith("{") && rem.startsWith("}")) ||
                (textBeforeCursor.trim().endsWith("[") && rem.startsWith("]")) ||
                (textBeforeCursor.trim().endsWith("(") && rem.startsWith(")"));

            if (isPairExplosion)
            {
                this.lines[this.cy] = textBeforeCursor;
                this.lines.splice(this.cy + 1, 0, indent);
                this.lines.splice(this.cy + 2, 0, baseIndent + rem);
                this.cy++;
                this.cx = indent.length;
            }
            else
            {
                this.lines[this.cy] = textBeforeCursor;
                this.lines.splice(this.cy + 1, 0, indent + rem);
                this.cy++;
                this.cx = indent.length;
            }
        }
        else if (data[0] === KEY.TAB)
        {
            this.saveState();
            const tabSpaces = "    ";
            this.lines[this.cy] = this.lines[this.cy].slice(0, this.cx) + tabSpaces + this.lines[this.cy].slice(this.cx);
            this.cx += tabSpaces.length;
        }
        else if (data[0] === KEY.DEL || data[0] === KEY.BS)
        {
            this.saveState();
            if (this.cx > 0)
            {
                const currentLine = this.lines[this.cy];
                const charBefore = currentLine[this.cx - 1];
                const charAt = currentLine[this.cx];

                if ((charBefore === "{" && charAt === "}") ||
                    (charBefore === "(" && charAt === ")") ||
                    (charBefore === "[" && charAt === "]"))
                {
                    this.lines[this.cy] = currentLine.slice(0, this.cx - 1) + currentLine.slice(this.cx + 1);
                    this.cx--;
                }
                else
                {
                    this.lines[this.cy] = currentLine.slice(0, this.cx - 1) + currentLine.slice(this.cx);
                    this.cx--;
                }
            }
            else if (this.cy > 0)
            {
                this.cx = this.lines[this.cy - 1].length;
                this.lines[this.cy - 1] += this.lines[this.cy];
                this.lines.splice(this.cy, 1);
                this.cy--;
            }
        }
        else if (data[0] >= 32 && data[0] !== KEY.ESC)
        {
            this.saveState();
            const currentLine = this.lines[this.cy];
            const pairs: Record<string, string> = {
                "{": "}",
                "(": ")",
                "[": "]"
            };

            if (pairs[str])
            {
                this.lines[this.cy] = currentLine.slice(0, this.cx) + str + pairs[str] + currentLine.slice(this.cx);
                this.cx++;
            }
            else if ((str === "}" || str === ")" || str === "]") && currentLine[this.cx] === str)
            {
                this.cx++;
            }
            else
            {
                this.lines[this.cy] = currentLine.slice(0, this.cx) + str + currentLine.slice(this.cx);
                this.cx += str.length;
            }
        }
        this.snapViewport();
        this.refresh();
    }
}