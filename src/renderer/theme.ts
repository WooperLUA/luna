export interface EditorTheme {
    gutterText: string; tilde: string; insertBar: string; commandBar: string; reset: string;
}

export let THEME: EditorTheme = {
    gutterText: "\x1b[38;5;146m", tilde: "\x1b[38;5;183m",
    insertBar: "\x1b[48;5;183;38;5;235m", commandBar: "\x1b[48;5;141;38;5;235m", reset: "\x1b[m"
};

export function applyTheme(config: Partial<EditorTheme>) {
    THEME = { ...THEME, ...config };
}
