import * as path from "node:path";
import * as console from "node:console";
import * as process from "node:process";
import url, { URL } from "node:url";
import { runTests } from "@vscode/test-electron";

const __dirname: string = url.fileURLToPath(new URL(".", import.meta.url));

async function main(): Promise<void> {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "..");

    // The path to the extension test script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./index");

    // Download VS Code, unzip it and run the integration test
    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err: unknown) {
    console.error("Failed to run tests");
    console.error(err);
    process.exit(1);
  }
}

main();
