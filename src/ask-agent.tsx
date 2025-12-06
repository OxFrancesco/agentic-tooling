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
  openRouterApiKey: string;
  daytonaApiKey: string;
}

interface FormValues {
  prompt: string;
  files: string[];
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();

  // Onboarding Check
  const isConfigured =
    preferences.workingDirectory && preferences.modelName && preferences.daytonaApiKey && preferences.openRouterApiKey;

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
    const { workingDirectory, modelName, openRouterApiKey, daytonaApiKey } = preferences;

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

      if (!fs.existsSync(path.dirname(logFile))) {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
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
      const runnerScript = `
import { execSync } from "child_process";
import fs from "fs";

// Install @daytonaio/sdk locally if not present
const pkgPath = "./node_modules/@daytonaio/sdk";
if (!fs.existsSync(pkgPath)) {
    console.log("Installing @daytonaio/sdk...");
    execSync("bun add @daytonaio/sdk", { stdio: "inherit" });
}

const { Daytona } = await import("@daytonaio/sdk");

const CHUNK_SIZE = 60000;
const CONTEXT_DIR = "/home/daytona/context";

const taskId = "${taskId}";
const tasksFile = "${tasksFile}";
const logFile = "${logFile}";
const apiKey = "${daytonaApiKey}";
const model = "openrouter/${modelName || "anthropic/claude-3.5-haiku"}";
const fileContents = ${JSON.stringify(fileContents)};
const envVars = ${JSON.stringify({ OPENROUTER_API_KEY: openRouterApiKey })};

const promptText = \`IMPORTANT INSTRUCTIONS:
1. You are running in a Daytona sandbox environment.
2. Create SINGLE-FILE executables (bun/uv) when asked to create tools.

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

function escapeSingleQuotes(value) {
    return value.replace(/'/g, "'" + '"' + "'" + '"' + "'");
}

function escapeForShell(value) {
    return value.replace(/'/g, "'\\\\''");
}

async function uploadFile(sandbox, remotePath, b64Content) {
    const escaped = escapeSingleQuotes(remotePath);
    const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
    await sandbox.process.executeCommand(\`mkdir -p '\${escapeSingleQuotes(dir)}' && : > '\${escaped}'\`);
    
    for (let i = 0; i < b64Content.length; i += CHUNK_SIZE) {
        const chunk = escapeSingleQuotes(b64Content.slice(i, i + CHUNK_SIZE));
        const res = await sandbox.process.executeCommand(\`echo '\${chunk}' | base64 -d >> '\${escaped}'\`);
        if ((res?.exitCode ?? res?.exit_code ?? 0) !== 0) {
            throw new Error(\`Failed to upload: \${res?.stderr || res?.result}\`);
        }
    }
}

async function main() {
    try {
        log("Creating Daytona sandbox...");
        const daytona = new Daytona({ apiKey });
        const sandbox = await daytona.create({ language: "typescript" });
        log(\`Sandbox created: \${sandbox.id || "unknown"}\`);

        log("Installing opencode via npm...");
        await sandbox.process.executeCommand("npm install -g opencode-ai 2>&1");
        log("OpenCode installed");

        if (fileContents.length > 0) {
            log(\`Uploading \${fileContents.length} context file(s)...\`);
            for (const file of fileContents) {
                const remotePath = \`\${CONTEXT_DIR}/\${file.name}\`;
                await uploadFile(sandbox, remotePath, file.b64);
                log(\`Uploaded: \${file.name}\`);
            }
        }

        let fullPrompt = promptText;
        if (fileContents.length > 0) {
            fullPrompt += \`\\n\\nContext files uploaded to \${CONTEXT_DIR}/:\\n\`;
            fullPrompt += fileContents.map(f => \`- \${f.name}\`).join("\\n");
        }

        let envSetup = "";
        for (const [key, value] of Object.entries(envVars)) {
            if (value) envSetup += \`export \${key}='\${escapeForShell(value)}' && \`;
        }

        log("Running opencode...");
        const escapedPrompt = escapeForShell(fullPrompt);
        const command = \`\${envSetup}opencode run --model '\${escapeForShell(model)}' '\${escapedPrompt}' --print-logs 2>&1\`;
        
        const result = await sandbox.process.executeCommand(command);
        const exitCode = result?.exitCode ?? result?.exit_code ?? 0;
        const output = result?.stdout || result?.result || "";
        
        log(\`OpenCode finished with exit code: \${exitCode}\`);
        log("Output:\\n" + output);

        log("Cleaning up sandbox...");
        await sandbox.delete();
        log("Sandbox deleted");

        updateTask(exitCode === 0 ? "completed" : "failed", Date.now());
        process.exit(exitCode);
    } catch (err) {
        log("Error: " + (err?.message || err));
        updateTask("failed", Date.now());
        process.exit(1);
    }
}

main();
`;
      fs.writeFileSync(scriptPath, runnerScript);

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
