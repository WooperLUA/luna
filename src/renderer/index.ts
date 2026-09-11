import {THEME} from "./theme";
import {getLanguage} from "./syntax";
import {highlightAndSlice} from "./highlighter";
import type {EditorMode} from "../types";

export class Renderer
{
    public static render(
        lines: string[], cx: number, cy: number, rowOffset: number, colOffset: number,
        mode: EditorMode, filename: string, commandBuffer: string,
        selection: { sy: number; sx: number; ey: number; ex: number } | null = null,
        commandUsage: string = " ",
        autocomplete?: { suggestions: string[], index: number, x: number, y: number }
    )
    {
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 24;
        let screen = "\x1b[H\x1b[2J";
        const lang = getLanguage(filename.split(".").pop() || "");
        const maxCols = cols - 7;

        for (let i = 0; i < rows - 1; i++)
        {
            const lineIdx = rowOffset + i;
            if (lineIdx < lines.length)
            {
                const lineNum = (lineIdx + 1).toString().padStart(3, " ");
                const text = highlightAndSlice(lines[lineIdx], lang, colOffset, maxCols, selection, lineIdx);
                screen += `${THEME.gutterText}${lineNum} │ ${THEME.reset}${text}\n`;
            }
            else
            {
                screen += `${THEME.tilde}~\x1b[K${THEME.reset}\n`;
            }
        }

        const barText = ` |${mode.toUpperCase()}| ${filename || "[Untitled]"} | ${cy + 1}:${cx + 1} | -> ${commandBuffer || "_"}`;
        const totalPad = Math.max(0, cols - barText.length);
        let leftPad = Math.floor(totalPad / 2);
        let rightPad = cols - leftPad - barText.length - commandUsage.length;
        if (rightPad < 0)
        {
            leftPad = Math.max(0, cols - barText.length - commandUsage.length);
            rightPad = 0;
        }

        const statusColor = mode === "insert" ? THEME.insertBar : THEME.commandBar;
        screen += `${statusColor}${" ".repeat(leftPad)}${barText}${" ".repeat(rightPad)}${commandUsage}${THEME.reset}`;

        if (autocomplete)
        {
            const popupY = autocomplete.y + 1;
            for (let i = 0; i < autocomplete.suggestions.length; i++)
            {
                if (popupY + i >= rows - 1) break;
                const isSelected = i === autocomplete.index;
                const bg = isSelected ? "\x1b[48;5;141m\x1b[38;5;235m" : "\x1b[48;5;235m\x1b[38;5;146m";
                screen += `\x1b[${popupY + i + 1};${autocomplete.x + 1}H${bg} ${autocomplete.suggestions[i]} ${THEME.reset}`;
            }
        }

        process.stdout.write(screen);
        if (mode === "command")
        {
            const prefix = ` |${mode.toUpperCase()}| ${filename || "[Untitled]"} | ${cy + 1}:${cx + 1} | -> `;
            process.stdout.write(`\x1b[${rows};${leftPad + prefix.length + commandBuffer.length + 1}H`);
        }
        else
        {
            process.stdout.write(`\x1b[${(cy - rowOffset) + 1};${(cx - colOffset) + 7}H`);
        }
    }
}