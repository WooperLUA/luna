export const KEY = {
    CTRL_A: 0x01, CTRL_C: 0x03, CTRL_Q: 0x11, CTRL_V: 0x16,
    CTRL_X: 0x18, CTRL_Y: 0x19, CTRL_Z: 0x1a, ESC: 0x1b,
    CR:     0x0d, LF: 0x0a, BS: 0x08, DEL: 0x7f, TAB: 0x09
};

export const SEQ = {
    CLEAR:       "\x1b[2J\x1b[H", SHIFT_UP: "\x1b[1;2A", SHIFT_DOWN: "\x1b[1;2B",
    SHIFT_RIGHT: "\x1b[1;2C", SHIFT_LEFT: "\x1b[1;2D", UP: "\x1b[A",
    DOWN:        "\x1b[B", RIGHT: "\x1b[C", LEFT: "\x1b[D"
};