import {readdirSync, statSync} from "node:fs";
import {join} from "node:path";
import type {LunaEditor} from "./index";
import type {FileTreeItem} from "../types";

export function generateTreeData(this: LunaEditor, dir: string, prefix = ""): FileTreeItem[]
{
    let results: FileTreeItem[] = [];
    if (/^[a-zA-Z]:$/.test(dir)) dir += "\\";

    try
    {
        const skip = new Set(["node_modules", ".git", ".bun-cache", "System Volume Information", "$Recycle.Bin", "Recovery", "PerfLogs", "Config.Msi"]);
        const items = readdirSync(dir).filter(item => !skip.has(item)).sort((a, b) => a.localeCompare(b));

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

            results.push({path, prefix: prefix + marker, name: item + (isDir ? "/" : ""), isDir});
            if (isDir) results.push(...this.generateTreeData(path, prefix + (isLast ? "    " : "│   ")));
        }
    }
    catch (err: any)
    {
        const msg = (err.code === 'EPERM' || err.code === 'EACCES') ? "[Access Denied]" : "[Error reading directory]";
        results.push({path: dir, prefix, name: msg, isDir: false});
    }
    return results;
}