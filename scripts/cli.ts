#!/usr/bin/env bun
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { parseArgs } from "util";

// Load .env file if present
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const [key, ...valueParts] = line.split("=");
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join("=").trim();
    }
  }
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    model: { type: "string", short: "m", default: process.env.MODEL_NAME || "anthropic/claude-haiku-4.5" },
    "retry-model": { type: "string", short: "r", default: process.env.RETRY_MODEL_NAME || "x-ai/grok-4.1-fast" },
    "working-dir": { type: "string", short: "w", default: process.cwd() },
    file: { type: "string", short: "f", multiple: true },
    timeout: { type: "string", short: "t", default: "600000" },
    quiet: { type: "boolean", short: "q" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
Usage: bun run scripts/cli.ts [options] <prompt>

Options:
  -h, --help            Show this help message
  -m, --model           Primary model ID (default: anthropic/claude-3.5-haiku)
  -r, --retry-model     Fallback model if primary refuses (default: deepseek/deepseek-chat)
  -w, --working-dir     Working directory to mount in Docker (default: current directory)
  -f, --file            Context file(s) to include (can be used multiple times)
  -t, --timeout         Timeout in milliseconds (default: 600000 = 10 min)
  -q, --quiet           Only output final result, suppress logs

Environment variables:
  OPENROUTER_API_KEY    Required. Your OpenRouter API key

Examples:
  bun run scripts/cli.ts "Create a hello world script"
  bun run scripts/cli.ts -m anthropic/claude-sonnet-4 "Refactor this code" -f ./src/index.ts
  OPENROUTER_API_KEY=xxx bun run scripts/cli.ts -w ./my-project "Add tests"
`);
  process.exit(0);
}

const prompt = positionals.join(" ");
if (!prompt) {
  console.error("Error: Prompt is required");
  process.exit(1);
}

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
if (!openRouterApiKey) {
  console.error("Error: OPENROUTER_API_KEY environment variable is required");
  process.exit(1);
}

const workingDirectory = path.resolve(values["working-dir"] as string);
const modelName = values.model as string;
const retryModelName = values["retry-model"] as string;
const timeout = parseInt(values.timeout as string, 10);
const quiet = values.quiet as boolean;

if (!fs.existsSync(workingDirectory)) {
  console.error(`Error: Working directory not found: ${workingDirectory}`);
  process.exit(1);
}

// Ensure tools directory exists
const toolsDirectory = path.join(workingDirectory, "tools");
if (!fs.existsSync(toolsDirectory)) {
  fs.mkdirSync(toolsDirectory, { recursive: true });
}

const DOCKER_IMAGE = "agentic-tooling:latest";

// Check Docker is available
try {
  execSync("docker --version", { encoding: "utf-8", stdio: "pipe" });
} catch {
  console.error("Error: Docker is not installed or not running");
  process.exit(1);
}

// Check if our Docker image exists, build if not
function ensureDockerImage(): void {
  try {
    execSync(`docker image inspect ${DOCKER_IMAGE}`, { encoding: "utf-8", stdio: "pipe" });
  } catch {
    console.log(`Docker image '${DOCKER_IMAGE}' not found. Building...`);
    const dockerfilePath = path.join(process.cwd(), "docker", "Dockerfile");
    if (!fs.existsSync(dockerfilePath)) {
      console.error("Error: docker/Dockerfile not found. Run from project root.");
      process.exit(1);
    }
    try {
      execSync(`docker build -t ${DOCKER_IMAGE} -f docker/Dockerfile .`, {
        encoding: "utf-8",
        stdio: "inherit",
      });
      console.log("Docker image built successfully.\n");
    } catch {
      console.error("Error: Failed to build Docker image");
      process.exit(1);
    }
  }
}

function log(msg: string) {
  if (!quiet) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
  }
}

function escapeForShell(value: string): string {
  return value.replace(/'/g, "'\\''");
}

const REFUSAL_PATTERNS = [
  "I can't help",
  "I cannot help",
  "I'm unable to",
  "I am unable to",
  "I can't assist",
  "I cannot assist",
  "against my guidelines",
  "I'm not able to",
  "I am not able to",
  "I won't be able",
  "I will not be able",
  "not something I can help with",
  "I'm sorry, but I can't",
  "I apologize, but I cannot",
  "need to decline",
  "I should not help",
  "I shouldn't help",
  "I must decline",
  "cannot fulfill this request",
  "can't fulfill this request",
];

function detectRefusal(output: string): boolean {
  const lowerOutput = output.toLowerCase();
  return REFUSAL_PATTERNS.some((pattern) => lowerOutput.includes(pattern.toLowerCase()));
}

function collectTools(): void {
  const toolExtensions = [".sh", ".ts", ".js", ".py"];
  const excludePatterns = [".runner-", "node_modules", ".git", ".agentic"];

  try {
    const files = fs.readdirSync(workingDirectory);
    for (const file of files) {
      // Skip if matches exclude pattern
      if (excludePatterns.some((p) => file.includes(p))) continue;

      // Check if it's a tool file
      if (toolExtensions.some((ext) => file.endsWith(ext))) {
        const srcPath = path.join(workingDirectory, file);
        const destPath = path.join(toolsDirectory, file);

        // Skip if not a file or already exists in tools
        if (!fs.statSync(srcPath).isFile()) continue;
        if (fs.existsSync(destPath)) continue;

        // Copy to tools directory
        fs.copyFileSync(srcPath, destPath);
        fs.chmodSync(destPath, 0o755);
        log(`Saved new tool: ${file}`);
      }
    }
  } catch (e) {
    log(`Warning: Failed to collect tools: ${e}`);
  }
}

async function runDocker(model: string, promptText: string): Promise<{ exitCode: number; output: string }> {
  const escapedPrompt = escapeForShell(promptText);

  const dockerArgs = [
    "run",
    "--rm",
    "-e",
    `OPENROUTER_API_KEY=${openRouterApiKey}`,
    "-v",
    `${workingDirectory}:/workspace`,
    "-v",
    `${toolsDirectory}:/tools:ro`,
    "-w",
    "/workspace",
    DOCKER_IMAGE,
    "opencode",
    "run",
    "--model",
    model,
    escapedPrompt,
    "--print-logs",
  ];

  log(`Running Docker with model: ${model}`);

  return new Promise((resolve) => {
    let output = "";
    const proc = spawn("docker", dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      if (!quiet) process.stdout.write(text);
    });

    proc.stderr.on("data", (data) => {
      const text = data.toString();
      output += text;
      if (!quiet) process.stderr.write(text);
    });

    const timeoutId = setTimeout(() => {
      proc.kill("SIGTERM");
      log("Docker process timed out");
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: code || 0,
        output,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      output += `\nError: ${err.message}`;
      resolve({
        exitCode: 1,
        output,
      });
    });
  });
}

// Build prompt text
let promptText = `You are running in a Docker container with FULL NETWORK ACCESS.
Execute tasks directly - you can download files, make API calls, etc.
Save any output files to /workspace directory.

IMPORTANT - TOOL REUSE:
Before creating any scripts or tools, check /tools directory for existing tools that might solve the task:
1. Run: ls -la /tools/ to see available tools
2. If a suitable tool exists, use it instead of creating a new one
3. If you must create a new tool, save it to /workspace with a descriptive filename

USER REQUEST:
${prompt}
`;

// Add context files if provided
const contextFiles = (values.file as string[]) || [];
if (contextFiles.length > 0) {
  promptText += "\n\nCONTEXT FILES:\n";
  for (const filePath of contextFiles) {
    try {
      const absPath = path.resolve(filePath);
      const content = fs.readFileSync(absPath, "utf-8");
      promptText += `\n--- ${path.basename(filePath)} ---\n${content}\n`;
      log(`Added context file: ${filePath}`);
    } catch (e) {
      console.error(`Warning: Failed to read file ${filePath}: ${e}`);
    }
  }
}

async function main() {
  ensureDockerImage();
  log("Starting Docker sandbox...");
  log(`Working directory: ${workingDirectory}`);
  log(`Primary model: openrouter/${modelName}`);
  if (retryModelName) {
    log(`Retry model: openrouter/${retryModelName}`);
  }

  let result = await runDocker(`openrouter/${modelName}`, promptText);

  log(`\nPrimary model finished with exit code: ${result.exitCode}`);

  // Check if model refused and retry model is configured
  if (retryModelName && detectRefusal(result.output)) {
    log("\n=== REFUSAL DETECTED - Retrying with fallback model ===\n");
    log(`Retrying with: openrouter/${retryModelName}`);

    result = await runDocker(`openrouter/${retryModelName}`, promptText);

    log(`\nRetry model finished with exit code: ${result.exitCode}`);
  }

  // Collect tools on successful run
  if (result.exitCode === 0) {
    collectTools();
  }

  process.exit(result.exitCode);
}

main();
