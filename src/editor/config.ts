import {readdirSync, statSync} from "node:fs";
import {join, dirname} from "node:path";
import {homedir} from "node:os";
import type {LunaEditor} from "./index";

export function getExtensionsDir(this: LunaEditor): string
{
    const exeDir = dirname(process.execPath);
    const portable = join(exeDir, "extensions");
    const dev = join(import.meta.dir, "extensions");
    const global = join(homedir(), ".luna", "extensions");

    try
    {
        if (statSync(portable).isDirectory()) return portable;
    }
    catch
    {
    }
    try
    {
        if (statSync(dev).isDirectory()) return dev;
    }
    catch
    {
    }
    return global;
}

export async function loadScripts(this: LunaEditor)
{
    const file = Bun.file(join(this.getExtensionsDir(), "scripts.json"));
    if (await file.exists())
    {
        try
        {
            const content = await file.json();
            for (const [name, command] of Object.entries(content))
            {
                if (typeof name === "string" && typeof command === "string") this.scripts.set(name, command);
            }
        }
        catch
        {
        }
    }
}

export async function loadKeywords(this: LunaEditor)
{
    const dir = join(this.getExtensionsDir(), "languages", "keywords");
    try
    {
        for (const file of readdirSync(dir))
        {
            if (file.endsWith(".json"))
            {
                const data = await Bun.file(join(dir, file)).json();
                if (Array.isArray(data)) this.autocompleteKeywords.set(file.slice(0, -5), data);
            }
        }
    }
    catch
    {
    }
}

export async function loadDefaultTheme(this: LunaEditor)
{
    const file = Bun.file(join(this.getExtensionsDir(), "themes", "luna.json"));
    if (await file.exists())
    {
        const {applyTheme} = await import("../renderer/theme");
        applyTheme(await file.json());
        this.refresh();
    }
}