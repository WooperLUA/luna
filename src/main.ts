#!/usr/bin/env bun
import {LunaEditor} from "./editor/";

const editor = new LunaEditor();
const filePath = Bun.argv[2];
if (filePath) await editor.openFile(filePath);