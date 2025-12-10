import {
  Form,
  ActionPanel,
  Action,
  showToast,
  Toast,
  getPreferenceValues,
  launchCommand,
  LaunchType,
  openExtensionPreferences,
} from "@raycast/api";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

interface Preferences {
  workingDirectory: string;
  modelName: string;
  retryModelName: string;
  openRouterApiKey: string;
}

interface FormValues {
  prompt: string;
  files: string[];
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();

  const isConfigured = preferences.workingDirectory && preferences.modelName && preferences.openRouterApiKey;

  if (!isConfigured) {
    return (
      <Form
        actions={
          <ActionPanel>
            <Action
              title="Go to Onboarding"
              onAction={() => launchCommand({ name: "onboarding", type: LaunchType.UserInitiated })}
            />
            <Action title="Open Preferences" onAction={openExtensionPreferences} />
          </ActionPanel>
        }
      >
        <Form.Description text="Please configure the extension before using it." />
      </Form>
    );
  }

  async function handleSubmit(values: FormValues) {
    const { prompt, files } = values;
    const { workingDirectory, modelName, retryModelName, openRouterApiKey } = preferences;

    if (!prompt) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Prompt is required",
      });
      return;
    }

    if (!fs.existsSync(workingDirectory)) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Working directory not found",
        message: workingDirectory,
      });
      return;
    }

    try {
      await showToast({
        style: Toast.Style.Animated,
        title: "Starting Agent...",
      });

      const envVars: Record<string, string> = {
        ...(process.env as Record<string, string>),
      };

      const home = process.env.HOME || "";
      envVars.PATH = `${home}/.bun/bin:/usr/local/bin:/opt/homebrew/bin:${envVars.PATH || ""}`;
      envVars["OPENROUTER_API_KEY"] = openRouterApiKey;

      const taskId = Date.now().toString();
      const logFile = `${workingDirectory}/.agentic-logs/${taskId}.log`;
      const tasksFile = `${workingDirectory}/.agentic-tasks.json`;
      const toolsDirectory = `${workingDirectory}/tools`;

      if (!fs.existsSync(path.dirname(logFile))) {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
      }

      if (!fs.existsSync(toolsDirectory)) {
        fs.mkdirSync(toolsDirectory, { recursive: true });
      }

      // Initialize task
      let tasks: { id: string; agent: string; prompt: string; startTime: number; status: string; logFile: string }[] =
        [];
      if (fs.existsSync(tasksFile)) {
        try {
          tasks = JSON.parse(fs.readFileSync(tasksFile, "utf-8"));
        } catch (e) {
          console.error("Failed to parse tasks file", e);
        }
      }
      tasks.push({
        id: taskId,
        agent: "opencode",
        prompt: prompt,
        startTime: Date.now(),
        status: "running",
        logFile: logFile,
      });
      fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));

      // Prepare file contents
      const fileContents: { name: string; b64: string }[] = [];
      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath);
          fileContents.push({
            name: path.basename(filePath),
            b64: content.toString("base64"),
          });
        } catch (e) {
          console.error(`Failed to read file ${filePath}`, e);
        }
      }

      const scriptPath = `${workingDirectory}/.runner-${taskId}.mjs`;
      const dockerfilePath = path.join(workingDirectory, "docker", "Dockerfile");
      const dockerContextPath = workingDirectory;
      const escapePathForTemplate = (value: string) => value.replace(/\\/g, "\\\\");

      // Docker-based runner script (full network access)
      const dockerRunnerScript = `
import { execSync, spawnSync } from "child_process";
import fs from "fs";

const DOCKER_IMAGE = "agentic-tooling:latest";
const taskId = "${taskId}";
const tasksFile = "${tasksFile}";
const logFile = "${logFile}";
const workingDirectory = "${workingDirectory}";
const toolsDirectory = "${toolsDirectory}";
const primaryModel = "openrouter/${modelName || "anthropic/claude-3.5-haiku"}";
const retryModel = "${retryModelName ? `openrouter/${retryModelName}` : ""}";
const openRouterApiKey = "${openRouterApiKey}";
const dockerfilePath = "${escapePathForTemplate(dockerfilePath)}";
const dockerContextPath = "${escapePathForTemplate(dockerContextPath)}";

const promptText = \`You are running in a Docker container with FULL NETWORK ACCESS.
Execute tasks directly - you can download files, make API calls, etc.
Save any output files to /workspace directory.

IMPORTANT - TOOL REUSE:
Before creating any scripts or tools, check /tools directory for existing tools that might solve the task:
1. Run: ls -la /tools/ to see available tools
2. If a suitable tool exists, use it instead of creating a new one
3. If you must create a new tool, save it to /workspace with a descriptive filename

IMPORTANT - INSTALLING PACKAGES:
For Python tools like yt-dlp, use: uv tool run yt-dlp [args]
This runs the tool without needing global installation.

USER REQUEST:
${prompt.replace(/`/g, "\\`").replace(/\$/g, "\\$")}
\`;

function log(msg) {
    const line = \`[\${new Date().toISOString()}] \${msg}\\n\`;
    fs.appendFileSync(logFile, line);
    console.log(msg);
}

function updateTask(status, endTime) {
    try {
        let tasks = [];
        if (fs.existsSync(tasksFile)) {
            tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
        }
        const idx = tasks.findIndex(t => t.id === taskId);
        if (idx !== -1) {
            tasks[idx].status = status;
            if (endTime) tasks[idx].endTime = endTime;
            fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
        }
    } catch(e) { log("Failed to update task: " + e); }
}

function escapeForShell(value) {
    return value.replace(/'/g, "'\\\\''");
}

function runDocker(model, prompt) {
    const escapedPrompt = escapeForShell(prompt);

    const dockerArgs = [
        "run", "--rm",
        "-e", \`OPENROUTER_API_KEY=\${openRouterApiKey}\`,
        "-v", \`\${workingDirectory}:/workspace\`,
        "-v", \`\${toolsDirectory}:/tools:ro\`,
        "-w", "/workspace",
        DOCKER_IMAGE,
        "opencode", "run", "--model", model, escapedPrompt, "--print-logs"
    ];
    
    log(\`Running: docker \${dockerArgs.slice(0, 5).join(" ")} ...\`);
    const result = spawnSync("docker", dockerArgs, { 
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        timeout: 600000 // 10 min timeout
    });
    
    return {
        exitCode: result.status || 0,
        output: (result.stdout || "") + (result.stderr || "")
    };
}

// Patterns that indicate model refusal
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
    "decline this request",
    "respectfully decline",
    "violates YouTube's Terms",
    "Terms of Service",
    "copyright infringement"
];

function detectRefusal(output) {
    const lowerOutput = output.toLowerCase();
    return REFUSAL_PATTERNS.some(pattern => lowerOutput.includes(pattern.toLowerCase()));
}

function ensureDockerImage() {
    // Use spawnSync for explicit exit code checking (more reliable than execSync throwing)
    const inspectResult = spawnSync("docker", ["image", "inspect", DOCKER_IMAGE], {
        encoding: "utf-8",
        stdio: "pipe"
    });
    
    if (inspectResult.status === 0) {
        // Image exists, verify it's actually usable
        const testResult = spawnSync("docker", ["run", "--rm", DOCKER_IMAGE, "echo", "test"], {
            encoding: "utf-8",
            stdio: "pipe",
            timeout: 30000
        });
        
        if (testResult.status === 0) {
            log("Docker image verified");
            return;
        }
        log("Docker image exists but is not usable, rebuilding...");
    } else {
        log("Docker image '" + DOCKER_IMAGE + "' not found. Building...");
    }

    if (!fs.existsSync(dockerfilePath)) {
        throw new Error(
            "Dockerfile not found at " + dockerfilePath + ". Please ensure you are using the repo version of the extension."
        );
    }

    log("Building Docker image from " + dockerfilePath + "...");
    const buildResult = spawnSync("docker", [
        "build", "-t", DOCKER_IMAGE, "-f", dockerfilePath, dockerContextPath
    ], {
        encoding: "utf-8",
        stdio: "inherit",
        timeout: 300000
    });
    
    if (buildResult.status !== 0) {
        throw new Error("Failed to build Docker image. Exit code: " + buildResult.status);
    }
    log("Docker image built successfully.");
}

function collectTools() {
    const toolExtensions = [".sh", ".ts", ".js", ".py"];
    const excludePatterns = [".runner-", "node_modules", ".git", ".agentic"];
    
    try {
        const files = fs.readdirSync(workingDirectory);
        for (const file of files) {
            if (excludePatterns.some(p => file.includes(p))) continue;
            if (toolExtensions.some(ext => file.endsWith(ext))) {
                const srcPath = workingDirectory + "/" + file;
                const destPath = toolsDirectory + "/" + file;
                try {
                    const stat = fs.statSync(srcPath);
                    if (!stat.isFile()) continue;
                    if (fs.existsSync(destPath)) continue;
                    fs.copyFileSync(srcPath, destPath);
                    fs.chmodSync(destPath, 0o755);
                    log("Saved new tool: " + file);
                } catch(e) {}
            }
        }
    } catch(e) {
        log("Warning: Failed to collect tools: " + e);
    }
}

try {
    log("Starting Docker sandbox...");
    
    // Check Docker is available
    try {
        execSync("docker info", { encoding: "utf-8", stdio: "pipe" });
        log("Docker is available");
    } catch (e) {
        throw new Error("Docker is not installed or not running");
    }

    ensureDockerImage();
    
    // Run with primary model
    log(\`Running opencode with primary model: \${primaryModel}\`);
    let result = runDocker(primaryModel, promptText);
    
    log(\`Primary model finished with exit code: \${result.exitCode}\`);
    log("Output:\\n" + result.output);
    
    // Check if model refused and retry model is configured
    if (retryModel && detectRefusal(result.output)) {
        log("\\n=== REFUSAL DETECTED - Retrying with fallback model ===\\n");
        log(\`Retrying with: \${retryModel}\`);
        
        result = runDocker(retryModel, promptText);
        
        log(\`Retry model finished with exit code: \${result.exitCode}\`);
        log("Retry Output:\\n" + result.output);
    }
    
    // Collect tools on successful run
    if (result.exitCode === 0) {
        collectTools();
    }
    
    // Cleanup workspace state after task is done
    log("Cleaning up workspace state...");
    try {
        execSync(\`rm -rf "\${workingDirectory}/.opencode" "\${workingDirectory}/.config/opencode" 2>/dev/null || true\`, { encoding: "utf-8" });
        log("Workspace cleanup done");
    } catch (e) {
        log("Cleanup warning: " + e.message);
    }
    
    updateTask(result.exitCode === 0 ? "completed" : "failed", Date.now());
    process.exit(result.exitCode);
} catch (err) {
    log("Error: " + (err?.message || err));
    updateTask("failed", Date.now());
    process.exit(1);
}
`;

      fs.writeFileSync(scriptPath, dockerRunnerScript);

      const out = fs.openSync(logFile, "a");
      const err = fs.openSync(logFile, "a");
      const subprocess = spawn("bun", [scriptPath], {
        cwd: workingDirectory,
        detached: true,
        stdio: ["ignore", out, err],
        env: envVars,
      });
      subprocess.unref();

      await showToast({
        style: Toast.Style.Success,
        title: "Agent started",
        message: "Check 'View Tasks' for progress",
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to start Agent",
        message: String(error),
      });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Run Task" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea id="prompt" title="Prompt" placeholder="What do you want to do?" />
      <Form.FilePicker id="files" title="Context Files" />
    </Form>
  );
}
