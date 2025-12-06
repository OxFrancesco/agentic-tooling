#!/usr/bin/env bun
/**
 * Daytona sandbox helper CLI
 * - Creates a sandbox
 * - Pushes local files into it (base64-chunked)
 * - Runs a command
 * - Pulls files back
 * - Cleans up the sandbox (unless --keep)
 *
 * Usage:
 *   bun run scripts/daytona-cli.ts -- --push local.txt:/tmp/in.txt --cmd "cat /tmp/in.txt" --pull /tmp/in.txt:out.txt
 */

import fs from "fs";
import path from "path";
import process from "process";
import { Daytona } from "@daytonaio/sdk";
import type { DaytonaSandbox } from "@daytonaio/sdk";

type RunResponse = {
    exit_code?: number;
    exitCode?: number;
    result?: string;
    stdout?: string;
    stderr?: string;
};

type PushPair = { local: string; remote: string };
type PullPair = { remote: string; local: string };

interface Options {
    apiKey?: string;
    language?: string;
    remoteDir: string;
    push: PushPair[];
    pull: PullPair[];
    cmd?: string;
    keep: boolean;
}

const DEFAULT_REMOTE_DIR = "/tmp/daytona-cli";
const CHUNK_SIZE = 60000; // keeps stdout under control

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        apiKey: process.env.DAYTONA_API_KEY,
        remoteDir: DEFAULT_REMOTE_DIR,
        push: [],
        pull: [],
        keep: false
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--api-key":
            case "--apiKey":
                opts.apiKey = argv[++i];
                break;
            case "--language":
                opts.language = argv[++i];
                break;
            case "--remote-dir":
            case "--remoteDir":
                opts.remoteDir = argv[++i];
                break;
            case "--push":
                opts.push.push(splitPair(argv[++i], opts.remoteDir, true) as PushPair);
                break;
            case "--pull":
                opts.pull.push(splitPair(argv[++i], opts.remoteDir, false) as PullPair);
                break;
            case "--cmd":
            case "--run":
                opts.cmd = argv[++i];
                break;
            case "--keep":
                opts.keep = true;
                break;
            case "--help":
            case "-h":
                printHelp();
                process.exit(0);
                break;
            default:
                throw new Error(`Unknown arg: ${arg}`);
        }
    }

    return opts;
}

function splitPair(value: string, remoteDir: string, isPush: boolean): PushPair | PullPair {
    const [left, right] = value.split(":");
    if (isPush) {
        const local = left;
        const remoteRaw = right || path.posix.basename(local);
        const remote = remoteRaw.startsWith("/") ? remoteRaw : path.posix.join(remoteDir, remoteRaw);
        return { local, remote };
    } else {
        const remoteRaw = left;
        const local = right || path.basename(remoteRaw);
        const remote = remoteRaw.startsWith("/") ? remoteRaw : path.posix.join(remoteDir, remoteRaw);
        return { remote, local };
    }
}

function code(res: RunResponse | undefined) {
    return res?.exitCode ?? res?.exit_code ?? 0;
}

function escapeSingleQuotes(value: string) {
    return value.replace(/'/g, "'\"'\"'");
}

async function pushFile(sandbox: DaytonaSandbox, pair: PushPair) {
    const buffer = await fs.promises.readFile(pair.local);
    const b64 = buffer.toString("base64");
    const remote = escapeSingleQuotes(pair.remote);
    const dir = path.posix.dirname(pair.remote);
    await sandbox.process.codeRun(`mkdir -p '${escapeSingleQuotes(dir)}' && : > '${remote}'`);

    for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
        const chunk = escapeSingleQuotes(b64.slice(i, i + CHUNK_SIZE));
        const res = (await sandbox.process.codeRun(
            `echo '${chunk}' | base64 -d >> '${remote}'`
        )) as RunResponse;
        if (code(res) !== 0) {
            throw new Error(`Failed to push ${pair.local}: ${res?.stderr || res?.result || "unknown error"}`);
        }
    }
    console.log(`Pushed ${pair.local} -> ${pair.remote}`);
}

async function pullFile(sandbox: DaytonaSandbox, pair: PullPair) {
    const remoteEsc = escapeSingleQuotes(pair.remote);
    const res = (await sandbox.process.codeRun(`base64 '${remoteEsc}'`)) as RunResponse;
    if (code(res) !== 0) {
        throw new Error(`Failed to pull ${pair.remote}: ${res?.stderr || res?.result || "unknown error"}`);
    }
    const data = res.result || res.stdout || "";
    const buf = Buffer.from(data.trim(), "base64");
    await fs.promises.mkdir(path.dirname(pair.local), { recursive: true });
    await fs.promises.writeFile(pair.local, buf);
    console.log(`Pulled ${pair.remote} -> ${pair.local}`);
}

function printHelp() {
    console.log(`Daytona sandbox CLI

Required:
  --api-key <value>             Daytona API key (or set DAYTONA_API_KEY)

File sync:
  --push <local[:remote]>       Push local file into sandbox (can repeat)
  --pull <remote[:local]>       Pull remote file to local (can repeat)
  --remote-dir <dir>            Base remote dir for relative paths (default ${DEFAULT_REMOTE_DIR})

Execution:
  --cmd|--run "<command>"       Command to run inside sandbox
  --language <lang>             Sandbox language (default typescript)
  --keep                        Do not delete sandbox after completion

Examples:
  bun run scripts/daytona-cli.ts -- --push ./foo.txt --cmd "cat /tmp/daytona-cli/foo.txt" --pull /tmp/daytona-cli/foo.txt:./foo.out
  bun run scripts/daytona-cli.ts -- --push foo.txt:input.txt --run "wc -l input.txt" --keep
`);
}

async function main() {
    try {
        const opts = parseArgs(process.argv.slice(2));
        if (!opts.apiKey) throw new Error("DAYTONA_API_KEY is required (or --api-key)");

        const daytona = new Daytona({ apiKey: opts.apiKey });
        const sandbox: DaytonaSandbox = await daytona.create({
            language: opts.language || "typescript"
        });

        console.log(`Sandbox created: ${sandbox.id || "[no id in response]"}`);

        for (const pair of opts.push) {
            await pushFile(sandbox, pair);
        }

        if (opts.cmd) {
            const runRes = (await sandbox.process.codeRun(opts.cmd)) as RunResponse;
            const exit = code(runRes);
            console.log(`Command exit: ${exit}`);
            if (runRes.stdout) console.log(runRes.stdout.trim());
            if (runRes.result && !runRes.stdout) console.log(runRes.result.trim());
            if (exit !== 0) {
                throw new Error(`Command failed: ${runRes.stderr || runRes.result || "unknown error"}`);
            }
        }

        for (const pair of opts.pull) {
            await pullFile(sandbox, pair);
        }

        if (!opts.keep) {
            await sandbox.delete();
            console.log("Sandbox deleted");
        } else {
            console.log("Sandbox kept (per --keep)");
        }
    } catch (err: any) {
        console.error(err?.message || err);
        process.exitCode = 1;
    }
}

void main();

