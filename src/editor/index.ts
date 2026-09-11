import {readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import type {EditorMode, FileTreeItem} from "../types";
import {KEY, SEQ} from "../constants";
import {saveState, undo, redo, snapViewport, getSelectionRange} from "./state";
import {getExtensionsDir, loadScripts, loadKeywords, loadDefaultTheme} from "./config";
import {generateTreeData} from "./file-tree";
import {initializeCommands} from "./commands";
import {
    handleRawInput,
    handleCommandInput,
    handleInsertInput,
    handleAutocomplete,
    applyAutocomplete,
    cancelAutocomplete
} from "./input";
import {Renderer} from "../renderer";

export class LunaEditor
{
    lines: string[] = [""];
    cx = 0;
    cy = 0;
    rowOffset = 0;
    colOffset = 0;
    filename = "";
    mode: EditorMode = "insert";
    commandBuffer = "";
    isViewingHelp = false;
    isViewingFileTree = false;
    fileTreeTargetDir = ".";
    fileTreeItems: FileTreeItem[] = [];
    fileTreeIndex = 0;
    fileTreeScrollOffset = 0;
    anchorX: number | null = null;
    anchorY: number | null = null;
    clipboard = "";
    history: Array<{ lines: string[]; cx: number; cy: number }> = [];
    redoStack: Array<{ lines: string[]; cx: number; cy: number }> = [];
    lastSearchText = "";
    autocompleteIndex = -1;
    pathAutocompleteMatches: string[] = [];
    pathAutocompleteIndex = -1;
    lastPathAutocompleteArg = "";
    isViewingOutput = false;
    outputLines: string[] = [];
    outputScrollOffset = 0;
    scripts: Map<string, string> = new Map();
    isSuspended = false;
    autocompleteKeywords: Map<string, string[]> = new Map();
    isAutocompleting = false;
    autocompleteSuggestions: string[] = [];
    lastAutocompleteBaseWord = "";
    autocompleteStartX = 0;
    commands = new Map<string, { desc: string; usage: string; action: (arg: string) => Promise<void> | void }>();

    constructor()
    {
        this.initializeCommands();
        this.setupTerminal();
        this.loadDefaultTheme();
        this.loadScripts();
        this.loadKeywords();
        this.refresh();
    }

    saveState = saveState;
    undo = undo;
    redo = redo;
    snapViewport = snapViewport;
    getSelectionRange = getSelectionRange;
    getExtensionsDir = getExtensionsDir;
    loadScripts = loadScripts;
    loadKeywords = loadKeywords;
    loadDefaultTheme = loadDefaultTheme;
    generateTreeData = generateTreeData;
    initializeCommands = initializeCommands;
    handleRawInput = handleRawInput;
    handleCommandInput = handleCommandInput;
    handleInsertInput = handleInsertInput;
    handleAutocomplete = handleAutocomplete;
    applyAutocomplete = applyAutocomplete;
    cancelAutocomplete = cancelAutocomplete;

    setupTerminal()
    {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", (data) => this.handleRawInput(Buffer.isBuffer(data) ? data : Buffer.from(data as any)));
        process.stdout.on("resize", () =>
        {
            this.snapViewport();
            this.refresh();
        });
    }

    refresh()
    {
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 24;
        let commandUsage = "";
        if (this.mode === "command" && this.commandBuffer.trim().length > 0)
        {
            const cmd = this.commands.get(this.commandBuffer.trim().split(";").pop()!.trim().split(" ")[0]);
            if (cmd)
                commandUsage = cmd.usage;
        }

        if (this.isViewingHelp)
        {
            const lines = ["--- COMMANDS CHEATSHEET ---", ""];
            for (const [name, cmd] of this.commands.entries())
                lines.push(`${name.padEnd(8)} : ${cmd.desc.padEnd(45)} | ${cmd.usage}`);
            if (this.scripts.size > 0)
            {
                lines.push("", "--- PREDEFINED SCRIPTS ---");
                for (const [n, c] of this.scripts.entries())
                    lines.push(`  ${n.padEnd(15)} : ${c}`);
            }
            lines.push("", "Press any key to close...");
            Renderer.render(lines, 0, 0, 0, 0, this.mode, "Help System", this.commandBuffer, null, commandUsage);
        }
        else if (this.isViewingFileTree)
        {
            const header = `--- File Tree : ${this.fileTreeTargetDir} ---`;
            const tree = [" ".repeat(Math.max(0, Math.floor((cols - header.length) / 2))) + header, ""];
            const end = Math.min(this.fileTreeScrollOffset + rows - 5, this.fileTreeItems.length);
            for (let i = this.fileTreeScrollOffset; i < end; i++)
            {
                const item = this.fileTreeItems[i];
                tree.push(i === this.fileTreeIndex ? `\x1b[7m${item.prefix}${item.name}\x1b[m` : `${item.prefix}${item.isDir ? "\x1b[1;36m" : "\x1b[32m"}${item.name}\x1b[0m`);
            }
            while (tree.length < rows - 2)
                tree.push("");
            const nav = "▲/▼: Navigate | ENTER: Select | ESC: Cancel";
            tree.push(" ".repeat(Math.max(0, Math.floor((cols - nav.length) / 2))) + nav);
            Renderer.render(tree, 0, 0, 0, 0, this.mode, "File Explorer", this.commandBuffer, null, commandUsage);
        }
        else if (this.isViewingOutput)
        {
            const panel = [`\x1b[1;36m--- Run Output ---\x1b[m`, ""];
            const end = Math.min(this.outputScrollOffset + rows - 4, this.outputLines.length);
            for (let i = this.outputScrollOffset; i < end; i++)
                panel.push(this.outputLines[i]);
            while (panel.length < rows - 2)
                panel.push("");
            const nav = "▲/▼: Scroll | 'q' or ESC: Close";
            panel.push(" ".repeat(Math.max(0, Math.floor((cols - nav.length) / 2))) + `\x1b[1;33m${nav}\x1b[m`);
            Renderer.render(panel, 0, 0, 0, 0, this.mode, "Command Runner", this.commandBuffer, null, commandUsage);
        }
        else
        {
            Renderer.render(this.lines, this.cx, this.cy, this.rowOffset, this.colOffset, this.mode, this.filename, this.commandBuffer, this.getSelectionRange(), commandUsage, this.isAutocompleting ? {
                suggestions: this.autocompleteSuggestions,
                index:       0,
                x:           this.autocompleteStartX - this.colOffset,
                y:           this.cy - this.rowOffset
            } : undefined);
        }
    }

    writeToSystemClipboard(text: string)
    {
        try
        {
            if (process.platform === "darwin") Bun.spawnSync({cmd: ["pbcopy"], stdin: Buffer.from(text)});
            else if (process.platform === "win32") Bun.spawnSync({cmd: ["clip"], stdin: Buffer.from(text)});
            else if (process.platform === "linux") Bun.spawnSync({
                cmd:   ["xclip", "-selection", "clipboard"],
                stdin: Buffer.from(text)
            });
        }
        catch
        {
        }
    }

    async openFile(path: string)
    {
        this.filename = path;
        const file = Bun.file(path);
        if (await file.exists())
        {
            this.lines = (await file.text()).split("\n");
            if (this.lines.length === 0) this.lines = [""];
            const ext = path.split(".").pop();
            if (ext)
            {
                const langFile = Bun.file(join(this.getExtensionsDir(), "languages", "syntax", `${ext}.json`));
                if (await langFile.exists())
                {
                    const {registerLanguage} = await import("../renderer/syntax");
                    registerLanguage(ext, await langFile.json());
                }
            }
        }
        else
        {
            this.lines = [""];
        }
        Object.assign(this, {cx: 0, cy: 0, rowOffset: 0, colOffset: 0, history: [], redoStack: []});
        this.refresh();
    }

    async executeCommand(cmd: string)
    {
        const [base, ...args] = cmd.split(" ");
        const command = this.commands.get(base);
        if (command) await command.action(args.join(" ").trim());
    }
}