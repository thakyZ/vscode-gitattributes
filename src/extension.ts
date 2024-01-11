'use strict';

// cSpell:ignore alexkaratarakis, ratelimit, addgitattributes

import * as vscode from 'vscode';
import { Cache, CacheItem } from './cache';
import { Octokit } from '@octokit/rest';

import { RequestRequestOptions } from "@octokit/types";

import { HttpsProxyAgent } from 'https-proxy-agent';
import * as fs from 'fs/promises';

class CancellationError extends Error { }

interface Bridge {
    gitattributesRepository: GitattributesRepository | undefined;
    proxy : string | undefined;
}

interface OctokitOptions {
    authStrategy?: string | undefined;
    auth?: string | undefined;
    userAgent?: string | undefined;
    previews?: string[] | undefined;
    baseUrl?: string | undefined;
    log?: {
        debug: (message: string) => unknown;
        info: (message: string) => unknown;
        warn: (message: string) => unknown;
        error: (message: string) => unknown;
    } | undefined;
    request?: RequestRequestOptions | undefined;
    timeZone?: string | undefined;
    [option: string]: string | string[] | object | RequestRequestOptions | undefined;
}

enum OperationType {
    append,
    overwrite
}

interface IError {
    code: number | string;
    message: string;
}

function instanceOfIError(object: unknown): object is IError {
    return typeof object === 'object' && object !== null && 'code' in object && 'message' in object;
}

interface GitattributesOperation {
    type: OperationType;
    path: string;
    file: GitattributesFile;
}

interface GitHubData {
    type: 'dir' | 'file' | 'submodule' | 'symlink';
    size: number;
    name: string;
    encoding: string;
    path: string;
    content?: string | undefined;
    sha: string;
    url: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    git_url: string | null;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    html_url: string | null;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    download_url: string | null;
    _links: GitHubDataLinks;
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
        const config = vscode.workspace.getConfiguration('gitattributes');
        this.cache = new Cache(config.get('cacheExpirationInterval', 86400));
    }

    /**
     * Get all .gitattributes files.
     */
    public async getFiles(path: string = ''): Promise<GitattributesFile[]> {
        // If cached, return from the cache.
        const item = this.cache.get('gitattributes/' + path);
        if (item !== undefined) {
            return item;
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
                throw new Error('Response sent wrong type.');
            }

            const files = responseData.filter((file: GitHubData) => {
                return (file.type === 'file' && file.name !== '.gitattributes' &&
                    file.name.endsWith('.gitattributes'));
            }).map((file : GitHubData) => {
                return {
                    label: file.name.replace(/\.gitattributes/, ''),
                    description: file.path,
                    url: file.path
                };
            });

            // Cache the retrieved gitattributes files.
            this.cache.add(new CacheItem('gitattributes/' + path, files));

            return files;
        } catch (error) {
            if (instanceOfIError(error)) {
                throw new Error(`${error.code}: ${error.message}`);
            } else {
                throw error;
            }
        }
    }

    /**
     * Downloads a .gitattributes from the repository to the path passed
     */
    public async download(operation: GitattributesOperation): Promise<GitattributesOperation> {
        const flags: string = operation.type === OperationType.overwrite ? 'w' : 'a';
        const file: fs.FileHandle = await fs.open(operation.path, flags);

        // If appending to the existing .gitattributes file, write a NEWLINE as a separator
        if (flags === 'a') {
            file.write('\n');
        }

        try {
            const { data } = await this.client.repos.getContent({
                owner: 'alexkaratarakis',
                repo: 'gitattributes',
                path: operation.file.url,
                headers: {
                    accept: 'application/json',
                }
            });

            let buffer : Buffer;

            const response = (data as GitHubData);

            if (response.type !== 'file' || !response.content) {
                throw new Error('Response sent wrong type.');
            }

            if (typeof response.content !== 'undefined') {
                if (response.encoding && response.encoding === 'base64') {
                    buffer = Buffer.from(response.content, 'base64');
                } else {
                    buffer = Buffer.from(response.content);
                }
            } else {
                console.log('vscode-gitattributes failed to get GitHub file content.');
                vscode.window.showErrorMessage('vscode-gitattributes failed to get GitHub file content.');
                throw new CancellationError();
            }

            await file.write(buffer);

            await file.close();

            if (flags === 'a') {
                const newFilename = await deduplicate(operation);
                await fs.unlink(operation.path);
                await fs.rename(newFilename, operation.path);
            }

            return operation;
        } catch (error) {
            // Delete the .gitattributes file if we created it.
            if (flags === 'w') {
                await fs.unlink(operation.path);
            }
            throw error;
        }
    }
}

/**
 * Remove '* text=auto' if already present.
 */
async function deduplicate(operation: GitattributesOperation) : Promise<string> {
    let found: boolean = false;
    const newPath: string = operation.path + '.new';
    const newFile: fs.FileHandle = await fs.open(newPath, 'w');
    const re: RegExp = new RegExp('\\* text=auto');
    const contents: Buffer = await fs.readFile(operation.path);
    const lines: string[] = contents.toString().split('\n');

    for await (const line of lines) {
        if (!line.match(re)) {
            await newFile.write(line.toString() + '\n');
        } else if (!found) {
            await newFile.write(line.toString() + '\n');
            found = true;
        } else {
            await newFile.write('# Commented because this line appears before in the file.\n');
            await newFile.write('# ' + line.toString() + '\n');
        }
    }

    return newPath;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getAgent(agent: HttpsProxyAgent | undefined, proxy: string | undefined): HttpsProxyAgent | undefined {
    if (typeof agent !== 'undefined') {
        return agent;
    }

    // Read proxy url in the following order: vscode settings, environment variables
    proxy = proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

    if (proxy) {
        agent = new HttpsProxyAgent(proxy);
    }

    return agent;
}

function constructGithubSpace(): Bridge {
    let client: Octokit | undefined;
    let gitattributesRepository: GitattributesRepository | undefined;
    let debug: boolean | undefined;
    let httpConfig: vscode.WorkspaceConfiguration | undefined;
    let proxy : string | undefined;

    try {
        const userAgent = 'vscode-gitattributes-extension';

        // Read proxy configuration.
        httpConfig = vscode.workspace.getConfiguration('http');
        proxy = httpConfig.get<string>('proxy', '');

        if (proxy) {
            console.log(`vscode-gitattributes: using proxy ${proxy}`);
        }

        debug = false;
        //debug = true;

        const auth: string | undefined = vscode.workspace.getConfiguration('gitattributes').get<string>('token');

        const options: OctokitOptions | undefined = {
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
        };

        if (typeof auth !== 'undefined' && auth !== '') {
            options['auth'] = auth;
        }

        // Create a GitHub API client.
        client = new Octokit(options);

        // Create a gitattributes repository.
        gitattributesRepository = new GitattributesRepository(client);
    } catch (error) {
        console.log('vscode-gitattributes failed to initialize with error:\n' + error);
        vscode.window.showErrorMessage('vscode-gitattributes failed to initialize with error:', (error as Error).toString());
    }

    return {
        gitattributesRepository: gitattributesRepository,
        proxy: proxy
    };
}

function getGitattributesFiles(gitattributesRepository: GitattributesRepository) {
    // Get list of .gitattributes files from GitHub.
    return Promise.all([
        gitattributesRepository.getFiles()
    ]).then((result) => {
        return Array.prototype.concat.apply([], result)
               .sort((a, b) => a.label.localeCompare(b.label));
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
        case OperationType.append:
            return vscode.window.showInformationMessage(`Appended ${operation.file.description} to the existing \
            .gitattributes in the project root`);
        case OperationType.overwrite:
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
    } catch (error) {
        if (error) {
            // File does not exist, we can create one.
            const value : GitattributesOperation = { path: path, file: file, type: OperationType.overwrite };
            return value;
        }
    }
}

export async function activate(context: vscode.ExtensionContext) : Promise<void> {
    const bridge = constructGithubSpace();

    console.log('gitattributes: extension is now active!');

    const disposable = vscode.commands.registerCommand('addgitattributes', async () => {
        // Check if we are in a workspace.
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage('No workspace open. Please open a workspace to use this command.');
            throw new CancellationError();
        }

        try {
            if (typeof bridge.gitattributesRepository === 'undefined') {
                console.log('vscode-gitattributes failed to initialize with error:\n' + 'Value of `gitattributesRepository` is typeof `undefined`.');
                vscode.window.showErrorMessage('vscode-gitattributes failed to initialize with error:', 'Value of `gitattributesRepository` is typeof `undefined`.');
                throw new CancellationError();
            }

            const file: GitattributesFile | undefined = await vscode.window.showQuickPick(getGitattributesFiles(bridge.gitattributesRepository));
            if (!file) {
                // Cancel
                throw new CancellationError();
            }

            let path = '';

            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1 && !vscode.window.activeTextEditor) {
                vscode.window.showErrorMessage('No text editor open. Please open a file relative to the workspace to use this command.');
                throw new CancellationError();
            } else {
                let workspaceFolder : vscode.WorkspaceFolder | undefined;
                if (vscode.workspace.workspaceFolders.length === 1) {
                    workspaceFolder = vscode.workspace.workspaceFolders[0];
                } else {
                    if (typeof vscode.window.activeTextEditor !== 'undefined') {
                        workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
                    } else {
                        vscode.window.showErrorMessage('No active text editor open. Please open a file relative to the workspace to use this command.');
                        throw new CancellationError();
                    }
                }
                if (workspaceFolder) {
                    path = workspaceFolder.uri.fsPath + '/.gitattributes';
                } else {
                    vscode.window.showErrorMessage('Workspace folder not found. Please open a workspace to use this command.');
                    throw new CancellationError();
                }
            }

            const operation: GitattributesOperation | undefined = await getOperation(path, file);

            if (typeof operation === 'undefined') {
                vscode.window.showErrorMessage('Operation returned undefined');
                throw new CancellationError();
            }

            // Store the file on file system.
            const doneOperation: GitattributesOperation = await bridge.gitattributesRepository.download(operation);

            showSuccessMessage(doneOperation);
        } catch (reason) {
            if (reason instanceof CancellationError) {
                return;
            }
            vscode.window.showErrorMessage('' + reason);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    console.log('gitattributes: extension is now deactivated.');
}
