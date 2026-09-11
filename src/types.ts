export type EditorMode = "insert" | "command";

export interface FileTreeItem {
    path: string;
    prefix: string;
    name: string;
    isDir: boolean;
}