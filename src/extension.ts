// cSpell:ignore alexkaratarakis, ratelimit, addgitattributes

import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import * as process from "node:process";
import * as console from "./logging.js";
import {
  window,
  commands,
  QuickPickItem,
  workspace,
  WorkspaceConfiguration,
  ExtensionContext,
} from "vscode";
import { Cache, CacheItem } from "./cache.js";
import { OctokitResponseWrapper } from "./OctokitResponseWrapper.js";
import { Octokit } from "@octokit/rest";
import { HttpsProxyAgent } from "https-proxy-agent";
import { setOutputChannel } from "./logging.js";
import type { OutputChannel, WorkspaceFolder } from "vscode";
import type { OctokitOptions, GitHubData } from "./OctokitResponseWrapper.js";

class CancellationError extends Error { }

interface Bridge {
  outputChannel: OutputChannel;
  gitattributesRepository: GitAttributesRepository | undefined;
  proxy: string | undefined;
}

interface Operation {
  label: string;
  description: string;
}

enum OperationType {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Append,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Overwrite,
}

interface GitAttributesOperation {
  type: OperationType;
  path: string;
  file: GitAttributesFile;
}

export interface GitAttributesFile extends QuickPickItem {
  url: string;
}

interface IError {
  // code: number | string;
  status: number | string;
  message: string;
}

function instanceOfIError(object: unknown): object is IError {
  return (
    typeof object === "object" &&
    // Because null is *technically* an object.
    object !== null &&
    "code" in object &&
    "message" in object
  );
}

export class GitAttributesRepository {
  private cache: Cache;

  public constructor(private client: Octokit) {
    const config = workspace.getConfiguration("gitattributes");
    this.cache = new Cache(config.get("cacheExpirationInterval", 86400));
  }

  /**
   * Get all .gitattributes files.
   */
  public async getFiles(path: string = ""): Promise<GitAttributesFile[]> {
    // If cached, return from the cache.
    const item = this.cache.get("gitattributes/" + path);
    if (typeof item !== "undefined") {
      return item;
    }

    // Download .gitattributes files from GitHub.
    let response: OctokitResponseWrapper | undefined = undefined;
    try {
      response = new OctokitResponseWrapper(
        await this.client.repos.getContent({
          owner: "alexkaratarakis",
          repo: "gitattributes",
          path: path,
          headers: {
            accept: "application/json",
          },
        })
      );

      if (typeof response === "undefined") {
        throw new TypeError("Type of the response is undefined.");
      }

      const responseData: Array<GitHubData> = response.get<Array<GitHubData>>();

      console.log(`vscode-gitattributes: GitHub API ratelimit remaining: ${response.headers["x-ratelimit-remaining"]}`);

      if (responseData === undefined || responseData.entries === undefined) {
        console.error(JSON.stringify(response ?? {}, null, 2));
        throw new Error("Response sent wrong type.");
      }

      const files = responseData.filter((file: GitHubData) => {
        return (
          file.type === "file" &&
          file.name !== ".gitattributes" &&
          file.name.endsWith(".gitattributes")
        );
      }).map((file: GitHubData) => {
        return {
          label: file.name.replace(/\.gitattributes/, ""),
          description: file.path,
          url: file.path,
        };
      });

      // Cache the retrieved gitattributes files.
      this.cache.add(new CacheItem("gitattributes/" + path, files));

      return files;
    } catch (error) {
      if (instanceOfIError(error)) {
        console.error(`JSON:\n${JSON.stringify(response?.data ?? {}, null, 2)}`);
        throw new Error(`${error.status}: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Downloads a .gitattributes from the repository to the path passed
   */
  public async download(operation: GitAttributesOperation): Promise<GitAttributesOperation> {
    const flags: string = operation.type === OperationType.Overwrite ? "w" : "a";
    const file: fs.FileHandle = await fs.open(operation.path, flags);

    // If appending to the existing .gitattributes file, write a NEWLINE as a separator
    if (flags === "a") {
      file.write("\n");
    }

    try {
      const { data } = await this.client.repos.getContent({
        owner: "alexkaratarakis",
        repo: "gitattributes",
        path: operation.file.url,
        headers: {
          accept: "application/json",
        },
      });

      let buffer: Buffer;

      const response = data as GitHubData;

      if (response.type !== "file" || !response.content) {
        throw new Error("Response sent wrong type.");
      }

      if (typeof response.content !== "undefined") {
        if (response.encoding && response.encoding === "base64") {
          buffer = Buffer.from(response.content, "base64");
        } else {
          buffer = Buffer.from(response.content);
        }
      } else {
        console.log("vscode-gitattributes failed to get GitHub file content.");
        window.showErrorMessage("vscode-gitattributes failed to get GitHub file content.");
        throw new CancellationError();
      }

      await file.write(buffer);

      await file.close();

      if (flags === "a") {
        const newFilename = await deduplicate(operation);
        await fs.unlink(operation.path);
        await fs.rename(newFilename, operation.path);
      }

      return operation;
    } catch (error) {
      // Delete the .gitattributes file if we created it.
      if (flags === "w") {
        await fs.unlink(operation.path);
      }

      throw error;
    }
  }
}

/**
 * Remove '* text=auto' if already present.
 */
async function deduplicate(operation: GitAttributesOperation): Promise<string> {
  let found: boolean = false;
  const newPath: string = `${operation.path}.new`;
  const newFile: fs.FileHandle = await fs.open(newPath, "w");
  const re: RegExp = new RegExp("\\* text=auto");
  const contents: Buffer = await fs.readFile(operation.path);
  const lines: string[] = contents.toString().split("\n");

  for await (const line of lines) {
    if (!line.match(re)) {
      await newFile.write(`${line.toString()}\n`);
    } else if (!found) {
      await newFile.write(`${line.toString()}\n`);
      found = true;
    } else {
      await newFile.write("# Commented because this line appears before in the file.\n");
      await newFile.write(`# ${line.toString()}\n`);
    }
  }

  return newPath;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getAgent<Proxy extends string>(agent: HttpsProxyAgent<Proxy> | undefined, proxy: Proxy | undefined): HttpsProxyAgent<Proxy> | undefined {
  if (agent !== undefined) {
    return agent;
  }

  // Read proxy url in the following order: vscode settings, environment variables
  proxy = (proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY) as Proxy | undefined;

  if (proxy) {
    agent = new HttpsProxyAgent(proxy);
  }

  return agent;
}

function constructGithubSpace(): Bridge {
  let client: Octokit | undefined;
  let gitattributesRepository: GitAttributesRepository | undefined;
  let debug: boolean | undefined;
  let httpConfig: WorkspaceConfiguration | undefined;
  let proxy: string | undefined;
  const outputChannel: OutputChannel = window.createOutputChannel("gitattributes");

  try {
    const userAgent = "vscode-gitattributes-extension";

    // Read proxy configuration.
    httpConfig = workspace.getConfiguration("http");
    proxy = httpConfig.get<string>("proxy", "");

    if (proxy) {
      console.log(`vscode-gitattributes: using proxy ${proxy}`);
    }

    debug = false;
    // debug = true;

    const auth: string | undefined = workspace
      .getConfiguration("gitattributes")
      .get<string>("token");

    const options: OctokitOptions | undefined = {
      userAgent,
      baseUrl: "https://api.github.com",
      log: {
        debug: (message: string) => {
          if (debug === true) {
            console.log(message);
          }
        },
        info: (message: string) => {
          if (debug === true) {
            console.log(message);
          }
        },
        warn: (message: string) => {
          if (debug === true) {
            console.log(message);
          }
        },
        error: (message: string) => {
          if (debug === true) {
            console.log(message);
          }
        },
      },
      request: {
        timeout: 100000,
      },
      proxy: proxy,
    };

    if (typeof auth !== "undefined" && auth !== "") {
      options["auth"] = auth;
    }

    // Create a GitHub API client.
    client = new Octokit(options);

    // Create a gitattributes repository.
    gitattributesRepository = new GitAttributesRepository(client);
  } catch (error) {
    handleError(error, "vscode-gitattributes failed to initialize with error:");
  }

  return {
    outputChannel,
    gitattributesRepository: gitattributesRepository,
    proxy: proxy,
  };
}

async function getGitattributesFiles(gitattributesRepository: GitAttributesRepository): Promise<GitAttributesFile[]> {
  // Get list of .gitattributes files from GitHub.
  const result = await gitattributesRepository.getFiles();
  return Array.prototype.concat
    .apply([], result)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function promptForOperation(): PromiseLike<Operation[] | undefined> {
  return window.showQuickPick([
    {
      label: "Append",
      description: "Append to existing .gitattributes file",
    },
    {
      label: "Overwrite",
      description: "Overwrite exiting .gitattributes file",
    },
  ],
  {
    canPickMany: true,
  });
}

function showSuccessMessage(operation: GitAttributesOperation): PromiseLike<string | undefined> {
  switch (operation.type) {
    case OperationType.Append:
      return window.showInformationMessage(`Appended ${operation.file.description} to the existing .gitattributes in the project root`);
    case OperationType.Overwrite:
      return window.showInformationMessage(`Created .gitattributes file in the project root based on ${operation.file.description}`);
    default:
      throw new Error("Unsupported operation");
  }
}

async function getOperation(path: string, file: GitAttributesFile): Promise<GitAttributesOperation[]> {
  const output: GitAttributesOperation[] = [];
  try {
    let operations: Operation[] | undefined = undefined;

    // Check if file exists
    if (existsSync(path)) {
      operations = await promptForOperation();

      if (!operations) {
        window.showErrorMessage("Operations returned undefined");
        console.error("Operations returned undefined");
        throw new CancellationError();
      }
    } else {
      operations = [{
        label: "Overwrite",
        description: "Overwrite exiting .gitattributes file",
      }];
    }

    for (const operation of operations) {
      try {
        if (typeof operation === "undefined") {
          // Cancel
          throw new CancellationError();
        }

        const value: GitAttributesOperation = {
          path: path,
          file: file,
          type: OperationType[operation.label as keyof typeof OperationType],
        };

        output.push(value);
      } catch (error) {
        if (typeof error !== "undefined") {
          // File does not exist, we can create one.
          const value: GitAttributesOperation = {
            path: path,
            file: file,
            type: OperationType.Overwrite,
          };

          output.push(value);
        }
      }
    }
  } catch (error) {
    handleError(error);
  }

  return output;
}

export async function activate(context: ExtensionContext): Promise<void> {
  const bridge = constructGithubSpace();
  setOutputChannel(bridge.outputChannel);

  console.log("gitattributes: extension is now active!");

  const disposable = commands.registerCommand(
    "addgitattributes",
    async (..._args: unknown[]): Promise<unknown> => {
      // Check if we are in a workspace.
      if (!workspace.workspaceFolders) {
        window.showErrorMessage("No workspace open. Please open a workspace to use this command.");
        console.error("No workspace open. Please open a workspace to use this command.");

        throw new CancellationError();
      }

      try {
        if (bridge.gitattributesRepository === undefined) {
          window.showErrorMessage("vscode-gitattributes failed to initialize with error:", "Value of `gitAttributesRepository` is typeof `undefined`.");
          console.error(`vscode-gitattributes failed to initialize with error:\nValue of \`gitAttributesRepository\` is typeof \`undefined\`.`);
          throw new CancellationError();
        }

        const file: GitAttributesFile | undefined = await window.showQuickPick(getGitattributesFiles(bridge.gitattributesRepository));

        if (!file) {
          // Cancel
          throw new CancellationError();
        }

        let path = "";

        if (workspace.workspaceFolders && workspace.workspaceFolders.length > 1 && !window.activeTextEditor) {
          window.showErrorMessage("No text editor open. Please open a file relative to the workspace to use this command.");
          console.error("No text editor open. Please open a file relative to the workspace to use this command.");
          throw new CancellationError();
        } else {
          let workspaceFolder: WorkspaceFolder | undefined;

          if (workspace.workspaceFolders.length === 1) {
            workspaceFolder = workspace.workspaceFolders[0];
          } else {
            if (window.activeTextEditor !== undefined) {
              workspaceFolder = workspace.getWorkspaceFolder(window.activeTextEditor.document.uri);
            } else {
              window.showErrorMessage("No active text editor open. Please open a file relative to the workspace to use this command.");
              console.error("No active text editor open. Please open a file relative to the workspace to use this command.");
              throw new CancellationError();
            }
          }

          if (workspaceFolder) {
            path = workspaceFolder.uri.fsPath + "/.gitattributes";
          } else {
            window.showErrorMessage("Workspace folder not found. Please open a workspace to use this command.");
            console.error("Workspace folder not found. Please open a workspace to use this command.");
            throw new CancellationError();
          }
        }

        const operations: GitAttributesOperation[] = await getOperation(path, file);

        for (const operation of operations) {
          // Store the file on file system.
          const doneOperation: GitAttributesOperation = await bridge.gitattributesRepository.download(operation);

          showSuccessMessage(doneOperation);
        }
      } catch (reason: unknown) {
        if (reason instanceof CancellationError) {
          return;
        }

        handleError(reason);
      }
    }
  );

  context.subscriptions.push(disposable);
}

function formatError(error: Error): string {
  const base: string = `[${error.name}] ${error.message}`;
  if (error.stack) {
    return `${base}\n${error.stack}`;
  }

  return base;
}

export function handleError(error: unknown, message: string | undefined = undefined): void {
  if (error instanceof Error) {
    if (message) {
      console.error(`[ERR] ${message}\n${formatError(error)}`);
    } else {
      console.error(`[ERR] ${formatError(error)}`);
    }
  } else if (typeof error === "string") {
    if (message) {
      console.error(`[ERR] ${message}\n${error}`);
    } else {
      console.error(`[ERR] ${error}`);
    }
  } else {
    if (message) {
      console.error(`[ERR] ${message}\n[${typeof error}] ${error}`);
    } else {
      console.error(`[ERR] [${typeof error}] ${error}`);
    }
  }

  if (message) {
    console.error(`${message}\n${error}`);
  } else {
    window.showErrorMessage(`${error}`);
  }
}

export function deactivate(): void {
  console.log("gitattributes: extension is now deactivated.");
}
