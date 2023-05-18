'use strict';
import * as vscode from 'vscode';
import { Cache, CacheItem } from './cache';
import { Octokit } from '@octokit/rest';

const HttpsProxyAgent = require('https-proxy-agent');
import * as fs from 'fs/promises';

class CancellationError extends Error { }

enum OperationType {
    Append,
    Overwrite
}

interface GitattributesOperation {
    type: OperationType;
    path: string;
    file: GitattributesFile;
}

interface GitHubData {
    type: "dir" | "file" | "submodule" | "symlink";
    size: number;
    name: string;
    path: string;
    content?: string | undefined;
    sha: string;
    url: string;
    git_url: string | null;
    html_url: string | null;
    download_url: string | null;
    _links: GitHubDataLinks[];
}

export interface GitHubDataLinks {
    git: string | null;
    html: string | null;
    self: string;
}

export interface GitattributesFile extends vscode.QuickPickItem {
    url: string;
}

export class GitattributesRepository {
    private cache: Cache;

    constructor(private client : Octokit) {
        let config = vscode.workspace.getConfiguration('gitattributes');
        this.cache = new Cache(config.get('cacheExpirationInterval', 86400));
    }

    /**
     * Get all .gitattributes files.
     */
    public async getFiles(path: string = ''): Promise<GitattributesFile[]> {
        // If cached, return from the cache.
        let item = this.cache.get('gitattributes/' + path);
        if (item !== undefined) {
            throw new Error("Variable item is type: undefined");
        }

        // Download .gitattributes files from GitHub.
        try {
            const response = await this.client.repos.getContent({
                owner: 'alexkaratarakis',
                repo: 'gitattributes',
                path: path,
                headers: {
                  accept: 'application/json',
                }
            });

            const responseData : GitHubData[] = response.data as unknown as GitHubData[];

            console.log(`vscode-gitattributes: GitHub API ratelimit remaining:
                ${response.headers['x-ratelimit-remaining']}`);

            if (!responseData || !responseData.entries) {
                throw new Error("Response sent wrong type.");
            }

            let files = responseData.filter((file : any) => {
                return (file.type === 'file' && file.name !== '.gitattributes' &&
                    file.name.endsWith('.gitattributes'));
            }).map((file : any) => {
                return {
                    label: file.name.replace(/\.gitattributes/, ''),
                    description: file.path,
                    url: file.path
                };
            });

            // Cache the retrieved gitattributes files.
            this.cache.add(new CacheItem('gitattributes/' + path, files));

            return files;
        } catch (err: any) {
            throw err;
        }
    }

    /**
     * Downloads a .gitattributes from the repository to the path passed
     */
    public async download(operation: GitattributesOperation): Promise<GitattributesOperation> {
        let flags : string = operation.type === OperationType.Overwrite ? 'w' : 'a';
        let file : fs.FileHandle = await fs.open(operation.path, flags);

        // If appending to the existing .gitattributes file, write a NEWLINE as a separator
        if (flags === 'a') {
            file.write('\n');
        }

        try {
            let response = await this.client.repos.getContent({
                owner: 'alexkaratarakis',
                repo: 'gitattributes',
                path: operation.file.url,
                headers: {
                    accept: 'application/json',
                }
            })
            let buffer : Buffer;

            if ((response.data as any).type !== 'file' || !(response.data as any).content) {
                throw new Error("Response sent wrong type.");
            }

            if ((response.data as any).encoding && (response.data as any).encoding === 'base64') {
                buffer = Buffer.from((response.data as any).content, 'base64');
            } else {
                buffer = Buffer.from((response.data as any).content);
            }

            await file.write(buffer);

            await file.close();

            if (flags === 'a') {
                let newFilename = await deduplicate(operation);
                await fs.unlink(operation.path);
                await fs.rename(newFilename, operation.path);
            }

            return operation;
        } catch (err : any) {
            // Delete the .gitattributes file if we created it.
            if (flags === 'w') {
                await fs.unlink(operation.path);
            }
            throw err;
        }
    }
}

/**
 * Remove "* text=auto" if already present.
 */
async function deduplicate(operation: GitattributesOperation) : Promise<string> {
    let found : boolean = false;
    let newPath : string = operation.path + '.new';
    let newFile : fs.FileHandle = await fs.open(newPath, 'w');
    let re = new RegExp('\\* text=auto');
    let contents : Buffer = await fs.readFile(operation.path);
    let lines : string[] = contents.toString().split('\n');
    for (const line of lines) {
        if (!line.match(re)) {
            await newFile.write(line.toString() + '\n');
        } else if (!found) {
            await newFile.write(line.toString() + '\n');
            found = true;
        } else {
            await newFile.write('# Commented because this line appears before in the file.\n');
            await newFile.write('# ' + line.toString() + '\n');
        }
    };
    return newPath;
}

const userAgent = 'vscode-gitattributes-extension';

// Read proxy configuration.
let httpConfig = vscode.workspace.getConfiguration('http');
let proxy : string | undefined = httpConfig.get<string>('proxy', '');

if (proxy) {
    console.log(`vscode-gitattributes: using proxy ${proxy}`);
}

let debug: boolean = false;
//debug = true;

let auth : string | undefined = vscode.workspace.getConfiguration('gitattributes').get<string>('token');

let options : any | undefined = {
    userAgent,
    baseUrl: 'https://api.github.com',
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
        }
    },
    request: {
        timeout: 100000
    },
    proxy: proxy
}

if (typeof auth !== undefined && auth !== '') {
    options['auth'] = auth;
}

// Create a GitHub API client.
let client = new Octokit(options);

// Create a gitattributes repository.
let gitattributesRepository = new GitattributesRepository(client);

let agent : typeof HttpsProxyAgent;

function getAgent() {
    if (agent) {
        return agent;
    }

    // Read proxy url in the following order: vscode settings, environment variables
    proxy = proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

    if (proxy) {
        agent = new HttpsProxyAgent(proxy);
    }

    return agent;
}

function getGitattributesFiles() {
    // Get list of .gitattributes files from GitHub.
    return Promise.all([
        gitattributesRepository.getFiles()
    ]).then((result) => {
        let files: GitattributesFile[] = Array.prototype.concat.apply([], result).sort((a, b) =>
            a.label.localeCompare(b.label));
        return files;
    });
}

function promptForOperation() {
    return vscode.window.showQuickPick([
        {
            label: 'Append',
            description: 'Append to existing .gitattributes file'
        },
        {
            label: 'Overwrite',
            description: 'Overwrite exiting .gitattributes file'
        }
    ]);
}

function showSuccessMessage(operation: GitattributesOperation) {
    switch (operation.type) {
        case OperationType.Append:
            return vscode.window.showInformationMessage(`Appended ${operation.file.description} to the existing \
            .gitattributes in the project root`);
        case OperationType.Overwrite:
            return vscode.window.showInformationMessage(`Created .gitattributes file in the project root based on \
            ${operation.file.description}`);
        default:
            throw new Error('Unsupported operation');
    }
}

async function getOperation(path : string, file: GitattributesFile) : Promise<GitattributesOperation | undefined> {
    try {
        // Check if file exists
        await fs.stat(path);
        promptForOperation().then((operation : { label : string, description: string } | undefined) => {
            if (!operation) {
                // Cancel
                throw new CancellationError();
            }
            const value : GitattributesOperation = { path: path, file: file, type: OperationType[operation.label as keyof typeof OperationType] };
            return value;
        });
    } catch (err : any | undefined) {
        if (err) {
            // File does not exist, we can create one.
            const value : GitattributesOperation = { path: path, file: file, type: OperationType.Overwrite };
            return value;
        }
    }
}

export async function activate(context: vscode.ExtensionContext) : Promise<void> {

    console.log('gitattributes: extension is now active!');

    let disposable = vscode.commands.registerCommand('addgitattributes', async () => {
        // Check if we are in a workspace.
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage('No workspace open. Please open a workspace to use this command.');
            return;
        }

        try {
            var file: GitattributesFile | undefined = await vscode.window.showQuickPick(getGitattributesFiles());
            if (!file) {
                // Cancel
                throw new CancellationError();
            }

            var path = '';

            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1 && !vscode.window.activeTextEditor) {
                vscode.window.showErrorMessage('No text editor open. Please open a file relative to the workspace to use this command.');
                throw new CancellationError();
            } else {
                const workspaceFolder =  vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor!.document.uri);
                if (!workspaceFolder) {
                    var path = workspaceFolder!.uri.fsPath + '/.gitattributes';
                } else {
                    vscode.window.showErrorMessage('Workspace folder not found. Please open a workspace to use this command.');
                    throw new CancellationError();
                }
            }

            var operation: GitattributesOperation | undefined = await getOperation(path, file);

            if (typeof operation === undefined) {
                vscode.window.showErrorMessage('Operation returned undefined');
            }

            // Store the file on file system.
            var doneOperation: GitattributesOperation = await gitattributesRepository.download(operation!);

            showSuccessMessage(doneOperation);
        } catch (reason : any) {
            if (reason instanceof CancellationError) {
                return;
            }
            vscode.window.showErrorMessage(reason);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    console.log('gitattributes: extension is now deactivated.');
}
