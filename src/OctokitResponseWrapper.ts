'use strict';

import { RequestRequestOptions, OctokitResponse, ResponseHeaders } from '@octokit/types';

interface IOctokitResponseWrapper {
    [option: string]: unknown
}

interface GitHubResponse {
    data: Array<IOctokitResponseWrapper>;
    headers: ResponseHeaders;
    status: number;
    url: string;
}

interface GitHubData extends IOctokitResponseWrapper {
    [option: string]: unknown;
    type: "dir" | "file" | "submodule" | "symlink";
    size: number;
    name: string;
    path: string;
    content?: string | undefined;
    sha: string;
    url: string;
/* eslint-disable @typescript-eslint/naming-convention */
    git_url: string | null;
    html_url: string | null;
    download_url: string | null;
/* eslint-enable @typescript-eslint/naming-convention */
    _links: GitHubDataLinks;
    encoding: "base64";
}

interface GitHubDataLinks {
    git: string | null;
    html: string | null;
    self: string;
}

interface OctokitOptions {
    authStrategy?: string | undefined;
    auth?: string | undefined;
    userAgent?: string | undefined;
    previews?: string[] | undefined;
    baseUrl?: string | undefined;
    log?: OctokitLogOptions | undefined;
    request?: RequestRequestOptions | undefined;
    timeZone?: string | undefined;
    [option: string]: string | string[] | object | RequestRequestOptions | undefined;
}

interface OctokitLogOptions {
    debug: (message: string) => unknown;
    info: (message: string) => unknown;
    warn: (message: string) => unknown;
    error: (message: string) => unknown;
}

class OctokitResponseWrapper implements GitHubResponse {
  public data: Array<IOctokitResponseWrapper>;
  public headers: ResponseHeaders;
  public status: number;
  public url: string;

  constructor(input: OctokitResponse<unknown, number>) {
    this.data = [];
    if (typeof input.data === "object" && Array.isArray(input.data)) {
      for (let i: number = 0; i < input.data.length; i++) {
        this.data.push(input.data[i]);
      }
    } else if (typeof input.data === "object" && !Array.isArray(input.data)) {
      this.data = [{}];
      for (const [key, value] of Object.entries(input.data ?? {})) {
        this.data[0][key] = value;
      }
    } else {
      throw TypeError(`Type of input.data is not an object, instead got "${typeof input.data}".`);
    }
    this.headers = input.headers;
    this.status = input.status;
    this.url = input.url;
  }

  get<T>(): T {
    const output: T = (this.data as T);
    if (typeof output === "undefined") {
      throw TypeError("The contained data could not be casted to typeof T");
    }
    return output;
  }
}

export { GitHubData, GitHubDataLinks, OctokitOptions, GitHubResponse, OctokitLogOptions, OctokitResponseWrapper, IOctokitResponseWrapper };
