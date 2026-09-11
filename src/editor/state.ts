import type {LunaEditor} from "./index";

export function saveState(this: LunaEditor)
{
    if (this.history.length > 200)
        this.history.shift();
    this.history.push({lines: [...this.lines], cx: this.cx, cy: this.cy});
    this.redoStack = [];
}

export function undo(this: LunaEditor)
{
    if (this.history.length > 0)
    {
        const previous = this.history.pop()!;
        this.redoStack.push({lines: [...this.lines], cx: this.cx, cy: this.cy});
        Object.assign(this, {lines: previous.lines, cx: previous.cx, cy: previous.cy});
        this.snapViewport();
        this.refresh();
    }
}

export function redo(this: LunaEditor)
{
    if (this.redoStack.length > 0)
    {
        const next = this.redoStack.pop()!;
        this.history.push({lines: [...this.lines], cx: this.cx, cy: this.cy});
        Object.assign(this, {lines: next.lines, cx: next.cx, cy: next.cy});
        this.snapViewport();
        this.refresh();
    }
}

export function snapViewport(this: LunaEditor)
{
    const rows = process.stdout.rows || 24;
    const cols = process.stdout.columns || 80;
    const visibleRows = rows - 1;
    const visibleCols = cols - 7;

    if (this.cy < this.rowOffset)
        this.rowOffset = this.cy;
    else if (this.cy >= this.rowOffset + visibleRows)
        this.rowOffset = this.cy - visibleRows + 1;

    if (this.cx < this.colOffset)
        this.colOffset = this.cx;
    else if (this.cx >= this.colOffset + visibleCols)
        this.colOffset = this.cx - visibleCols + 1;
}

export function getSelectionRange(this: LunaEditor)
{
    if (this.anchorX === null || this.anchorY === null) return null;
    const forward = this.anchorY < this.cy || (this.anchorY === this.cy && this.anchorX <= this.cx);
    return forward
        ? {sy: this.anchorY, sx: this.anchorX, ey: this.cy, ex: this.cx}
        : {sy: this.cy, sx: this.cx, ey: this.anchorY, ex: this.anchorX};
}