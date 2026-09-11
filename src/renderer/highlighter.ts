import {THEME} from "./theme";

export interface Segment
{
    text: string;
    color: string | null;
    isSelected?: boolean;
}

export function highlightAndSlice(
    rawLine: string, lang: { regex: RegExp; colors: string[] } | undefined,
    colOffset: number, maxCols: number, selection: {
        sy: number;
        sx: number;
        ey: number;
        ex: number
    } | null, lineIndex: number
): string
{
    const segments: Segment[] = [];
    let lastIndex = 0;
    if (lang)
    {
        for (const match of rawLine.matchAll(lang.regex))
        {
            if (match.index! > lastIndex) segments.push({text: rawLine.slice(lastIndex, match.index!), color: null});
            let color: string | null = null;
            for (let idx = 0; idx < lang.colors.length; idx++)
            {
                if (match[idx + 1] !== undefined)
                {
                    color = lang.colors[idx];
                    break;
                }
            }
            segments.push({text: match[0], color});
            lastIndex = match.index! + match[0].length;
        }
    }
    if (lastIndex < rawLine.length) segments.push({text: rawLine.slice(lastIndex), color: null});

    if (selection)
    {
        const isSel = lineIndex >= selection.sy && lineIndex <= selection.ey;
        if (isSel)
        {
            const newSegs: Segment[] = [];
            let visIdx = 0;
            for (const seg of segments)
            {
                const start = visIdx, end = visIdx + seg.text.length;
                let selStart = -1, selEnd = -1;
                if (lineIndex === selection.sy && lineIndex === selection.ey)
                {
                    selStart = selection.sx;
                    selEnd = selection.ex;
                }
                else if (lineIndex === selection.sy)
                {
                    selStart = selection.sx;
                    selEnd = Infinity;
                }
                else if (lineIndex === selection.ey)
                {
                    selStart = 0;
                    selEnd = selection.ex;
                }
                else if (lineIndex > selection.sy && lineIndex < selection.ey)
                {
                    selStart = 0;
                    selEnd = Infinity;
                }

                if (selStart !== -1)
                {
                    const beforeEnd = Math.min(end, selStart), duringStart = Math.max(start, selStart),
                        duringEnd = Math.min(end, selEnd), afterStart = Math.max(start, selEnd);
                    if (start < beforeEnd) newSegs.push({text: seg.text.slice(0, beforeEnd - start), color: seg.color});
                    if (duringStart < duringEnd) newSegs.push({
                        text:       seg.text.slice(duringStart - start, duringEnd - start),
                        color:      seg.color,
                        isSelected: true
                    });
                    if (afterStart < end) newSegs.push({text: seg.text.slice(afterStart - start), color: seg.color});
                }
                else
                {
                    newSegs.push(seg);
                }
                visIdx += seg.text.length;
            }
            segments.splice(0, segments.length, ...newSegs);
        }
    }

    let result = "", visualCol = 0;
    for (const seg of segments)
    {
        if (visualCol >= colOffset + maxCols) break;
        const segEnd = visualCol + seg.text.length;
        if (segEnd <= colOffset)
        {
            visualCol += seg.text.length;
            continue;
        }
        const sliceStart = Math.max(0, colOffset - visualCol);
        const sliceEnd = Math.min(seg.text.length, colOffset + maxCols - visualCol);
        const visible = seg.text.slice(sliceStart, sliceEnd);
        let colorCode = "";
        if (seg.isSelected) colorCode += "\x1b[7m";
        if (seg.color) colorCode += seg.color;
        const reset = (seg.isSelected || seg.color) ? THEME.reset : "";
        result += `${colorCode}${visible}${reset}`;
        visualCol += seg.text.length;
    }
    return result;
}