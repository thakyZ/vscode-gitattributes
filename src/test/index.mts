import * as path from "node:path";
import * as console from "node:console";
import Mocha from "mocha";
import { glob } from "glob";
import { URL, fileURLToPath } from "node:url";

export function run(): Promise<void> {
  const __dirname: string = fileURLToPath(new URL(".", import.meta.url));
  // Create the mocha test
  const mocha = new Mocha({
    ui: "tdd",
  });

  const testsRoot = path.resolve(__dirname, "..");

  return new Promise((resolve, reject) => {
    (async (): Promise<void> => {
      const files: unknown | string[] = await glob("**/**.test.js", { cwd: testsRoot });

      if (Array.isArray(files)) {
        // Add files to the test suite
        files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

        try {
          // Run the mocha test
          mocha.run((failures: number) => {
            if (failures > 0) {
              reject(new Error(`${failures} tests failed.`));
            } else {
              resolve();
            }
          });
        } catch (err) {
          console.error(err);
          reject(err);
        }
      } else {
        return reject(files);
      }
    })();
  });
}
