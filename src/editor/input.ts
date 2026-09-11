import type {LunaEditor} from "./index";
import {KEY, SEQ} from "../constants";

export function handleRawInput(this: LunaEditor, data: Buffer)
{
    if (this.isSuspended) return;
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
        const h = process.stdout.rows - 5;
        if (str === SEQ.UP && this.fileTreeIndex > 0)
        {
            this.fileTreeIndex--;
            if (this.fileTreeIndex < this.fileTreeScrollOffset) this.fileTreeScrollOffset = this.fileTreeIndex;
            this.refresh();
            return;
        }
        if (str === SEQ.DOWN && this.fileTreeIndex < this.fileTreeItems.length - 1)
        {
            this.fileTreeIndex++;
            if (this.fileTreeIndex >= this.fileTreeScrollOffset + h) this.fileTreeScrollOffset++;
            this.refresh();
            return;
        }
        if (key === KEY.CR || key === KEY.LF)
        {
            const sel = this.fileTreeItems[this.fileTreeIndex];
            if (sel && !sel.isDir)
            {
                this.isViewingFileTree = false;
                this.openFile(sel.path);
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
    if (this.isViewingOutput)
    {
        const h = process.stdout.rows - 4;
        const max = Math.max(0, this.outputLines.length - h);
        if (str === SEQ.UP && this.outputScrollOffset > 0)
        {
            this.outputScrollOffset--;
            this.refresh();
            return;
        }
        if (str === SEQ.DOWN && this.outputScrollOffset < max)
        {
            this.outputScrollOffset++;
            this.refresh();
            return;
        }
        if (str === "q" || key === KEY.ESC || key === KEY.CTRL_Q)
        {
            this.isViewingOutput = false;
            this.outputLines = [];
            this.refresh();
            return;
        }
        return;
    }

    if (data.length === 1)
    {
        if (key === KEY.CTRL_Q)
        {
            process.stdin.setRawMode(false);
            process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
            process.exit(0);
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
                const text = range.sy === range.ey ? [this.lines[range.sy].slice(range.sx, range.ex)] : [this.lines[range.sy].slice(range.sx), ...this.lines.slice(range.sy + 1, range.ey), this.lines[range.ey].slice(0, range.ex)];
                this.clipboard = text.join("\n");
                this.writeToSystemClipboard(this.clipboard);
                this.anchorX = this.anchorY = null;
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
                const text = range.sy === range.ey ? [this.lines[range.sy].slice(range.sx, range.ex)] : [this.lines[range.sy].slice(range.sx), ...this.lines.slice(range.sy + 1, range.ey), this.lines[range.ey].slice(0, range.ex)];
                this.clipboard = text.join("\n");
                this.writeToSystemClipboard(this.clipboard);
                if (range.sy === range.ey) this.lines[range.sy] = this.lines[range.sy].slice(0, range.sx) + this.lines[range.sy].slice(range.ex);
                else
                {
                    this.lines[range.sy] = this.lines[range.sy].slice(0, range.sx) + this.lines[range.ey].slice(range.ex);
                    this.lines.splice(range.sy + 1, range.ey - range.sy);
                }
                Object.assign(this, {cx: range.sx, cy: range.sy, anchorX: null, anchorY: null});
                this.snapViewport();
                this.refresh();
            }
            return;
        }
        if (key === KEY.CTRL_V && this.clipboard)
        {
            this.saveState();
            this.anchorX = this.anchorY = null;
            const lines = this.clipboard.split("\n");
            if (lines.length === 1)
            {
                this.lines[this.cy] = this.lines[this.cy].slice(0, this.cx) + lines[0] + this.lines[this.cy].slice(this.cx);
                this.cx += lines[0].length;
            }
            else
            {
                const before = this.lines[this.cy].slice(0, this.cx), after = this.lines[this.cy].slice(this.cx);
                this.lines.splice(this.cy, 1, before + lines[0], ...lines.slice(1, -1), lines[lines.length - 1] + after);
                this.cy += lines.length - 1;
                this.cx = lines[lines.length - 1].length;
            }
            this.snapViewport();
            this.refresh();
            return;
        }
    }

    const isShift = str === SEQ.SHIFT_UP || str === SEQ.SHIFT_DOWN || str === SEQ.SHIFT_RIGHT || str === SEQ.SHIFT_LEFT;
    const isNormal = str === SEQ.UP || str === SEQ.DOWN || str === SEQ.LEFT || str === SEQ.RIGHT;

    if (isShift || isNormal)
    {
        if (isShift && this.anchorX === null)
        {
            this.anchorX = this.cx;
            this.anchorY = this.cy;
        }
        else if (isNormal)
        {
            this.anchorX = this.anchorY = null;
        }
        if (str === SEQ.UP || str === SEQ.SHIFT_UP)
        {
            if (this.cy > 0) this.cy--;
        }
        else if (str === SEQ.DOWN || str === SEQ.SHIFT_DOWN)
        {
            if (this.cy < this.lines.length - 1) this.cy++;
        }
        else if (str === SEQ.LEFT || str === SEQ.SHIFT_LEFT)
        {
            if (this.cx > 0) this.cx--; else if (this.cy > 0)
            {
                this.cy--;
                this.cx = this.lines[this.cy].length;
            }
        }
        else if (str === SEQ.RIGHT || str === SEQ.SHIFT_RIGHT)
        {
            if (this.cx < this.lines[this.cy].length) this.cx++; else if (this.cy < this.lines.length - 1)
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
        if (this.isAutocompleting)
        {
            this.cancelAutocomplete();
            return;
        }
        this.mode = this.mode === "insert" ? "command" : "insert";
        this.commandBuffer = "";
        this.anchorX = this.anchorY = null;
        this.refresh();
        return;
    }
    if (!isShift && key !== KEY.CTRL_A && key !== KEY.CTRL_C && key !== KEY.CTRL_V && key !== KEY.CTRL_X)
    {
        this.anchorX = this.anchorY = null;
    }

    if (this.mode === "command") this.handleCommandInput(data);
    else this.handleInsertInput(data);
}

export function handleCommandInput(this: LunaEditor, data: Buffer)
{
    const str = data.toString();
    if (data[0] === KEY.CR || data[0] === KEY.LF)
    {
        const cmds = this.commandBuffer.trim().split(";").map(c => c.trim()).filter(c => c.length > 0);
        this.commandBuffer = "";
        this.autocompleteIndex = -1;
        this.lastSearchText = "";
        for (const cmd of cmds) this.executeCommand(cmd);
        this.mode = "insert";
    }
    else if (data[0] === KEY.TAB)
    {
        const parts = this.commandBuffer.trim().split(/\s+/);
        const cmd = parts[0];
        if (cmd === ".run" && parts.length > 1)
        {
            const lastSpace = this.commandBuffer.lastIndexOf(" ");
            const arg = this.commandBuffer.substring(lastSpace + 1);
            if (this.lastPathAutocompleteArg !== arg || this.pathAutocompleteMatches.length === 0)
            {
                this.lastPathAutocompleteArg = arg;
                this.pathAutocompleteIndex = -1;
                this.pathAutocompleteMatches = Array.from(this.scripts.keys()).filter(n => n.startsWith(arg));
            }
            if (this.pathAutocompleteMatches.length > 0)
            {
                this.pathAutocompleteIndex = (this.pathAutocompleteIndex + 1) % this.pathAutocompleteMatches.length;
                this.commandBuffer = this.commandBuffer.substring(0, lastSpace + 1) + this.pathAutocompleteMatches[this.pathAutocompleteIndex];
            }
            this.refresh();
            return;
        }
        else
        {
            if (this.autocompleteIndex === -1) this.lastSearchText = this.commandBuffer;
            const matches = Array.from(this.commands.keys()).filter(c => c.startsWith(this.lastSearchText));
            if (matches.length > 0)
            {
                this.autocompleteIndex = (this.autocompleteIndex + 1) % matches.length;
                this.commandBuffer = matches[this.autocompleteIndex];
            }
        }
        this.refresh();
    }
    else if (data[0] === KEY.DEL || data[0] === KEY.BS)
    {
        if (this.commandBuffer.length > 0) this.commandBuffer = this.commandBuffer.slice(0, -1);
        this.autocompleteIndex = -1;
        this.lastSearchText = "";
        this.refresh();
    }
    else if (data[0] >= 32 && data[0] !== KEY.ESC)
    {
        this.commandBuffer += str;
        this.autocompleteIndex = -1;
        this.lastSearchText = "";
        this.refresh();
    }
}

export function handleInsertInput(this: LunaEditor, data: Buffer)
{
    const str = data.toString();
    if (data[0] === KEY.TAB)
    {
        this.handleAutocomplete();
        if (this.isAutocompleting) return;
        this.saveState();
        this.lines[this.cy] = this.lines[this.cy].slice(0, this.cx) + "    " + this.lines[this.cy].slice(this.cx);
        this.cx += 4;
        this.snapViewport();
        this.refresh();
        return;
    }

    if (data[0] === KEY.CR || data[0] === KEY.LF)
    {
        this.saveState();
        const line = this.lines[this.cy], before = line.slice(0, this.cx), rem = line.slice(this.cx);
        const indent = (before.match(/^\s*/)?.[0] || "") + ((before.trim().endsWith("{") || before.trim().endsWith("[") || before.trim().endsWith("(")) ? "    " : "");
        const explode = (before.trim().endsWith("{") && rem.startsWith("}")) || (before.trim().endsWith("[") && rem.startsWith("]")) || (before.trim().endsWith("(") && rem.startsWith(")"));
        if (explode)
        {
            this.lines[this.cy] = before;
            this.lines.splice(this.cy + 1, 0, indent, (before.match(/^\s*/)?.[0] || "") + rem);
            this.cy++;
            this.cx = indent.length;
        }
        else
        {
            this.lines[this.cy] = before;
            this.lines.splice(this.cy + 1, 0, indent + rem);
            this.cy++;
            this.cx = indent.length;
        }
    }
    else if (data[0] === KEY.DEL || data[0] === KEY.BS)
    {
        this.saveState();
        if (this.cx > 0)
        {
            const line = this.lines[this.cy], cb = line[this.cx - 1], ca = line[this.cx];
            if ((cb === "{" && ca === "}") || (cb === "(" && ca === ")") || (cb === "[" && ca === "]") || (cb === '"' && ca === '"') || (cb === "'" && ca === "'") || (cb === "`" && ca === "`"))
            {
                this.lines[this.cy] = line.slice(0, this.cx - 1) + line.slice(this.cx + 1);
                this.cx--;
            }
            else
            {
                this.lines[this.cy] = line.slice(0, this.cx - 1) + line.slice(this.cx);
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
        const line = this.lines[this.cy];
        const pairs: Record<string, string> = {"{": "}", "(": ")", "[": "]", '"': '"', "'": "'", "`": "`"};
        if (pairs[str])
        {
            this.lines[this.cy] = line.slice(0, this.cx) + str + pairs[str] + line.slice(this.cx);
            this.cx++;
        }
        else if ((str === "}" || str === ")" || str === "]" || str === '"' || str === "'" || str === "`") && line[this.cx] === str)
        {
            this.cx++;
        }
        else
        {
            this.lines[this.cy] = line.slice(0, this.cx) + str + line.slice(this.cx);
            this.cx += str.length;
        }
    }
    this.snapViewport();
    this.refresh();
}

export function handleAutocomplete(this: LunaEditor)
{
    const match = this.lines[this.cy].slice(0, this.cx).match(/([a-zA-Z0-9_#]+)$/);
    if (!match)
    {
        this.isAutocompleting = false;
        return;
    }
    const base = match[1];
    if (!this.isAutocompleting || this.lastAutocompleteBaseWord !== base)
    {
        this.lastAutocompleteBaseWord = base;
        this.saveState();
        const ext = this.filename.split(".").pop()?.toLowerCase() || "default";
        const keys = this.autocompleteKeywords.get(ext) || this.autocompleteKeywords.get("default") || [];
        const words = new Set<string>();
        for (const line of this.lines) line.match(/[a-zA-Z0-9_#]+/g)?.forEach(w => words.add(w));
        this.autocompleteSuggestions = Array.from(new Set([...keys, ...words])).filter(w => w.startsWith(base) && w.length > base.length).sort((a, b) =>
        {
            const aK = keys.includes(a), bK = keys.includes(b);
            if (aK && !bK) return -1;
            if (!aK && bK) return 1;
            return a.localeCompare(b);
        });
        this.autocompleteStartX = this.cx - base.length;
        this.isAutocompleting = this.autocompleteSuggestions.length > 0;
    }
    else
    {
        // Cycling logic can be added here
    }
    if (this.isAutocompleting) this.applyAutocomplete();
}

export function applyAutocomplete(this: LunaEditor)
{
    if (!this.isAutocompleting || this.autocompleteSuggestions.length === 0) return;
    const sug = this.autocompleteSuggestions[0];
    const line = this.lines[this.cy];
    this.lines[this.cy] = line.slice(0, this.autocompleteStartX) + sug + line.slice(this.cx);
    this.cx = this.autocompleteStartX + sug.length;
    this.snapViewport();
    this.refresh();
}

export function cancelAutocomplete(this: LunaEditor)
{
    this.isAutocompleting = false;
    this.refresh();
}