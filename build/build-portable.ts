import { $ } from "bun";
import { mkdir, cp, rm } from "node:fs/promises";
import { join } from "node:path";

const ASSETS_FILE_NAME = "build/assets";
const PORTABLE_DIR = "build/out/luna-portable";
const EXTENSIONS_SRC = "src/extensions";
const EXTENSIONS_DEST = join(PORTABLE_DIR, "extensions");

async function buildPortable() {
    console.log(process.cwd());
    console.log("Building portable Luna editor...\n");

    console.log("Cleaning up old build...");
    await rm(PORTABLE_DIR, { recursive: true, force: true });

    console.log("Creating portable directory...");
    await mkdir(PORTABLE_DIR, { recursive: true });

    console.log("Compiling binary...");
    const isWindows = process.platform === "win32";
    const exeName = isWindows ? "luna.exe" : "luna";

    const buildResult = await $`bun build ./src/main.ts --compile --windows-icon=${ASSETS_FILE_NAME}/luna-logo.ico --outfile ./${PORTABLE_DIR}/${exeName}`;

    if (buildResult.exitCode !== 0) {
        console.error("Build failed!");
        process.exit(1);
    }

    console.log("Copying extensions...");
    await cp(EXTENSIONS_SRC, EXTENSIONS_DEST, { recursive: true });

    console.log(`\nSuccess! Portable version created in ./${PORTABLE_DIR}/`);
}

buildPortable().catch((err) => {
    console.error("An error occurred:", err);
    process.exit(1);
});