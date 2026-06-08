import { EditorMode } from "./types";

export interface EditorTheme {
    gutterText: string;
    tilde: string;
    insertBar: string;
    commandBar: string;
    reset: string;
}

export interface SyntaxRule {
    pattern: string;
    color: string;
}

interface CompiledLanguage {
    regex: RegExp;
    colors: string[];
}

interface Segment {
    text: string;
    color: string | null;
    isSelected?: boolean;
}

export let THEME: EditorTheme = {
    gutterText: "\x1b[38;5;146m",
    tilde: "\x1b[38;5;183m",
    insertBar: "\x1b[48;5;183;38;5;235m",
    commandBar: "\x1b[48;5;141;38;5;235m",
    reset: "\x1b[m"
};

const LANGUAGE_REGISTRY = new Map<string, CompiledLanguage>();

export function applyTheme(config: Partial<EditorTheme>) {
    THEME = { ...THEME, ...config };
}

export function registerLanguage(ext: string, rules: SyntaxRule[]) {
    const combinedPattern = rules.map(r => `(${r.pattern})`).join("|");
    const regex = new RegExp(combinedPattern, "g");
    const colors = rules.map(r => r.color);
    LANGUAGE_REGISTRY.set(ext, { regex, colors });
}

export class Renderer {
    /**
     * Tokenizes, highlights, applies selection, and slices the line perfectly.
     */
    private static highlightAndSlice(
        rawLine: string,
        lang: CompiledLanguage | undefined,
        colOffset: number,
        maxCols: number,
        selection: { sy: number; sx: number; ey: number; ex: number } | null,
        lineIndex: number
    ): string {
        const segments: Segment[] = [];
        let lastIndex = 0;

        if (lang) {
            for (const match of rawLine.matchAll(lang.regex)) {
                if (match.index! > lastIndex) {
                    segments.push({ text: rawLine.slice(lastIndex, match.index!), color: null });
                }

                let color: string | null = null;

                for (let idx = 0; idx < lang.colors.length; idx++) {
                    if (match[idx + 1] !== undefined) {
                        color = lang.colors[idx];
                        break;
                    }
                }
                segments.push({ text: match[0], color });
                lastIndex = match.index! + match[0].length;
            }
        }

        if (lastIndex < rawLine.length) {
            segments.push({ text: rawLine.slice(lastIndex), color: null });
        }

        if (selection) {
            const isLineSelected = lineIndex >= selection.sy && lineIndex <= selection.ey;
            if (isLineSelected) {
                const newSegments: Segment[] = [];
                let currentVisualIndex = 0;

                for (const seg of segments) {
                    const segLen = seg.text.length;
                    const segStart = currentVisualIndex;
                    const segEnd = currentVisualIndex + segLen;

                    let selStart = -1, selEnd = -1;

                    if (lineIndex === selection.sy && lineIndex === selection.ey) {
                        selStart = selection.sx;
                        selEnd = selection.ex;
                    } else if (lineIndex === selection.sy) {
                        selStart = selection.sx;
                        selEnd = Infinity;
                    } else if (lineIndex === selection.ey) {
                        selStart = 0;
                        selEnd = selection.ex;
                    } else if (lineIndex > selection.sy && lineIndex < selection.ey) {
                        selStart = 0;
                        selEnd = Infinity;
                    }

                    if (selStart !== -1) {
                        const beforeEnd = Math.min(segEnd, selStart);
                        const duringStart = Math.max(segStart, selStart);
                        const duringEnd = Math.min(segEnd, selEnd);
                        const actualAfterStart = Math.max(segStart, selEnd);

                        if (segStart < beforeEnd) {
                            newSegments.push({ text: seg.text.slice(0, beforeEnd - segStart), color: seg.color });
                        }
                        if (duringStart < duringEnd) {
                            newSegments.push({
                                text: seg.text.slice(duringStart - segStart, duringEnd - segStart),
                                color: seg.color,
                                isSelected: true
                            });
                        }
                        if (actualAfterStart < segEnd) {
                            newSegments.push({ text: seg.text.slice(actualAfterStart - segStart), color: seg.color });
                        }
                    } else {
                        newSegments.push(seg);
                    }

                    currentVisualIndex += segLen;
                }
                segments.splice(0, segments.length, ...newSegments);
            }
        }

        let result = "";
        let visualCol = 0;

        for (const seg of segments) {
            if (visualCol >= colOffset + maxCols) break;

            const segLen = seg.text.length;
            const segEnd = visualCol + segLen;

            if (segEnd <= colOffset) {
                visualCol += segLen;
                continue;
            }

            const sliceStart = Math.max(0, colOffset - visualCol);
            const sliceEnd = Math.min(segLen, colOffset + maxCols - visualCol);

            const visibleText = seg.text.slice(sliceStart, sliceEnd);

            let colorCode = "";
            if (seg.isSelected) {
                colorCode += "\x1b[7m";
            }
            if (seg.color) {
                colorCode += seg.color;
            }

            const resetCode = (seg.isSelected || seg.color) ? THEME.reset : "";

            result += `${colorCode}${visibleText}${resetCode}`;
            visualCol += segLen;
        }

        return result;
    }

    public static render(
        lines: string[],
        cx: number,
        cy: number,
        rowOffset: number,
        colOffset: number,
        mode: EditorMode,
        filename: string,
        commandBuffer: string,
        selection: { sy: number; sx: number; ey: number; ex: number } | null = null,
        commandUsage: string = " ",
        autocomplete?: { suggestions: string[], x: number, y: number }
    )  {
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 24;
        let screen = "\x1b[H\x1b[2J";
        const ext = filename.split(".").pop() || "";
        const lang = LANGUAGE_REGISTRY.get(ext);

        const visibleTextRows = rows - 1;
        const maxCols = cols - 7;

        for (let i = 0; i < visibleTextRows; i++) {
            const lineIndex = rowOffset + i;
            if (lineIndex < lines.length) {
                const lineNum = (lineIndex + 1).toString().padStart(3, " ");
                const rawLine = lines[lineIndex];

                const lineText = Renderer.highlightAndSlice(
                    rawLine,
                    lang,
                    colOffset,
                    maxCols,
                    selection,
                    lineIndex
                );

                screen += `${THEME.gutterText}${lineNum} │ ${THEME.reset}${lineText}\n`;
            } else {
                screen += `${THEME.tilde}~\x1b[K${THEME.reset}\n`;
            }
        }

        const fileLabel = filename || "[Untitled]";
        const modeLabel = mode.toUpperCase();
        const barText = ` |${modeLabel}| ${fileLabel} | ${cy + 1}:${cx + 1} | -> ${commandBuffer || "_"}`;

        const totalPadding = Math.max(0, cols - barText.length);
        let leftPadding = Math.floor(totalPadding / 2);
        let rightPadding = cols - leftPadding - barText.length - commandUsage.length;

        if (rightPadding < 0) {
            leftPadding = Math.max(0, cols - barText.length - commandUsage.length);
            rightPadding = 0;
        }

        const finalBarText = " ".repeat(leftPadding) + barText + " ".repeat(rightPadding) + commandUsage;

        const statusBarColor = mode === "insert" ? THEME.insertBar : THEME.commandBar;
        screen += `${statusBarColor}${finalBarText}${THEME.reset}`;

        if (autocomplete)
        {
            const { suggestions, x, y } = autocomplete;
            const popupY = y + 1;

            for (let i = 0; i < suggestions.length; i++)
            {

                if (popupY + i >= rows - 1) break;

                const sug = suggestions[i];
                const isSelected = i === 0;

                const bg = isSelected ? "\x1b[48;5;141m\x1b[38;5;235m" : "\x1b[48;5;235m\x1b[38;5;146m";
                const reset = THEME.reset;

                screen += `\x1b[${popupY + i + 1};${x + 1}H${bg} ${sug} ${reset}`;
            }
        }

        process.stdout.write(screen);

        if (mode === "command") {
            const barTextPrefix = ` |${modeLabel}| ${fileLabel} | ${cy + 1}:${cx + 1} | -> `;
            const renderCol = leftPadding + barTextPrefix.length + commandBuffer.length + 1;
            process.stdout.write(`\x1b[${rows};${renderCol}H`);
        } else {
            const renderRow = (cy - rowOffset) + 1;
            const renderCol = (cx - colOffset) + 7;
            process.stdout.write(`\x1b[${renderRow};${renderCol}H`);
        }
    }
}