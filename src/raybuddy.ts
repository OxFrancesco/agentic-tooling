import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const REPO_NAME = "RayBuddy";
const LOCAL_PATH = path.join(os.homedir(), ".raybuddy");

export function getLocalRepoPath(): string {
  return LOCAL_PATH;
}

export function isRayBuddyConfigured(githubToken?: string): boolean {
  if (!githubToken) return false;
  return fs.existsSync(LOCAL_PATH) && fs.existsSync(path.join(LOCAL_PATH, ".git"));
}

function getGitHubUsername(token: string): string | null {
  try {
    const result = execSync(`curl -s -H "Authorization: token ${token}" https://api.github.com/user`, {
      encoding: "utf-8",
      timeout: 10000,
    });
    const data = JSON.parse(result);
    return data.login || null;
  } catch {
    return null;
  }
}

function repoExists(token: string, username: string): boolean {
  try {
    const result = spawnSync(
      "curl",
      [
        "-s",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "-H",
        `Authorization: token ${token}`,
        `https://api.github.com/repos/${username}/${REPO_NAME}`,
      ],
      { encoding: "utf-8", timeout: 10000 },
    );
    return result.stdout?.trim() === "200";
  } catch {
    return false;
  }
}

function createRepo(token: string): boolean {
  try {
    const result = spawnSync(
      "curl",
      [
        "-s",
        "-X",
        "POST",
        "-H",
        `Authorization: token ${token}`,
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify({
          name: REPO_NAME,
          private: true,
          description: "Personal tool repository for Agentic Tooling",
          auto_init: true,
        }),
        "https://api.github.com/user/repos",
      ],
      { encoding: "utf-8", timeout: 30000 },
    );
    const response = JSON.parse(result.stdout || "{}");
    return !!response.id;
  } catch {
    return false;
  }
}

function cloneRepo(token: string, username: string): boolean {
  try {
    if (fs.existsSync(LOCAL_PATH)) {
      fs.rmSync(LOCAL_PATH, { recursive: true, force: true });
    }
    const repoUrl = `https://${token}@github.com/${username}/${REPO_NAME}.git`;
    execSync(`git clone "${repoUrl}" "${LOCAL_PATH}"`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60000,
    });
    return true;
  } catch {
    return false;
  }
}

export interface SetupResult {
  success: boolean;
  error?: string;
  username?: string;
}

export async function ensureRayBuddyRepo(githubToken: string): Promise<SetupResult> {
  const username = getGitHubUsername(githubToken);
  if (!username) {
    return { success: false, error: "Invalid GitHub token or unable to fetch user" };
  }

  if (fs.existsSync(LOCAL_PATH) && fs.existsSync(path.join(LOCAL_PATH, ".git"))) {
    return { success: true, username };
  }

  const exists = repoExists(githubToken, username);
  if (!exists) {
    const created = createRepo(githubToken);
    if (!created) {
      return { success: false, error: "Failed to create RayBuddy repository" };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const cloned = cloneRepo(githubToken, username);
  if (!cloned) {
    return { success: false, error: "Failed to clone RayBuddy repository" };
  }

  return { success: true, username };
}

export function syncToolsFromRepo(): boolean {
  if (!fs.existsSync(LOCAL_PATH)) return false;

  try {
    const gitDir = path.join(LOCAL_PATH, ".git");
    execSync(`git --git-dir="${gitDir}" --work-tree="${LOCAL_PATH}" pull --rebase origin main`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return true;
  } catch {
    return false;
  }
}

export function syncToolsToRepo(files: string[]): boolean {
  if (!fs.existsSync(LOCAL_PATH)) return false;
  if (files.length === 0) return true;

  try {
    const gitDir = path.join(LOCAL_PATH, ".git");
    const gitCmd = `git --git-dir="${gitDir}" --work-tree="${LOCAL_PATH}"`;

    for (const file of files) {
      const srcPath = file;
      const destPath = path.join(LOCAL_PATH, path.basename(file));
      if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
        fs.chmodSync(destPath, 0o755);
      }
    }

    execSync(`${gitCmd} add -A`, { encoding: "utf-8", stdio: "pipe", cwd: LOCAL_PATH });

    const status = execSync(`${gitCmd} status --porcelain`, { encoding: "utf-8", stdio: "pipe" });
    if (!status.trim()) return true;

    execSync(`${gitCmd} commit -m "Add new tools from Agentic Tooling"`, {
      encoding: "utf-8",
      stdio: "pipe",
      cwd: LOCAL_PATH,
    });

    execSync(`${gitCmd} push origin main`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    return true;
  } catch {
    return false;
  }
}

export function collectNewTools(workingDirectory: string): string[] {
  const toolExtensions = [".sh", ".ts", ".js", ".py"];
  const excludePatterns = [".runner-", "node_modules", ".git", ".agentic"];
  const newTools: string[] = [];

  try {
    const files = fs.readdirSync(workingDirectory);
    for (const file of files) {
      if (excludePatterns.some((p) => file.includes(p))) continue;
      if (!toolExtensions.some((ext) => file.endsWith(ext))) continue;

      const srcPath = path.join(workingDirectory, file);
      const destPath = path.join(LOCAL_PATH, file);

      if (!fs.statSync(srcPath).isFile()) continue;
      if (fs.existsSync(destPath)) continue;

      newTools.push(srcPath);
    }
  } catch {
    // ignore errors
  }

  return newTools;
}
