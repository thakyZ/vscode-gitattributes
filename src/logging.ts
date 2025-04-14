import type { OutputChannel } from "vscode";

let outputChannel: OutputChannel | undefined;

export function getOutputChannel(): OutputChannel {
  if (outputChannel === undefined) {
    throw new Error("Output channel has not ben set yet dispite being requested.");
  }

  return outputChannel;
}

export function setOutputChannel(channel: OutputChannel): void {
  outputChannel ??= channel;
}

export function log(...args: unknown[]): void {
  getOutputChannel().appendLine(`[Info - ${new Date(Date.now()).getTime().toLocaleString()}]: ${args.join(" | ")}`);
}

export function error(...args: unknown[]): void {
  getOutputChannel().appendLine(`[Error - ${new Date(Date.now()).getTime().toLocaleString()}]: ${args.join(" | ")}`);
}
