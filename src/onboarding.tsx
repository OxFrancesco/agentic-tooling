import {
  Action,
  ActionPanel,
  Detail,
  openExtensionPreferences,
  getPreferenceValues,
  showToast,
  Toast,
} from "@raycast/api";
import { useState } from "react";
import { ensureRayBuddyRepo, isRayBuddyConfigured, getLocalRepoPath } from "./raybuddy";

interface Preferences {
  workingDirectory: string;
  modelName: string;
  openRouterApiKey: string;
  githubToken?: string;
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [setupStatus, setSetupStatus] = useState<string | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);

  const raybuddyConfigured = isRayBuddyConfigured(preferences.githubToken);

  async function handleSetupRayBuddy() {
    if (!preferences.githubToken) {
      await showToast({
        style: Toast.Style.Failure,
        title: "GitHub Token Required",
        message: "Please add your GitHub token in preferences first",
      });
      return;
    }

    setIsSettingUp(true);
    setSetupStatus("Setting up RayBuddy...");

    await showToast({
      style: Toast.Style.Animated,
      title: "Setting up RayBuddy...",
    });

    const result = await ensureRayBuddyRepo(preferences.githubToken);

    if (result.success) {
      setSetupStatus(`RayBuddy configured! Repository: ${result.username}/RayBuddy`);
      await showToast({
        style: Toast.Style.Success,
        title: "RayBuddy Ready",
        message: `Repository created at github.com/${result.username}/RayBuddy`,
      });
    } else {
      setSetupStatus(`Setup failed: ${result.error}`);
      await showToast({
        style: Toast.Style.Failure,
        title: "Setup Failed",
        message: result.error,
      });
    }

    setIsSettingUp(false);
  }

  const raybuddyStatus = raybuddyConfigured
    ? `**Status**: Configured at \`${getLocalRepoPath()}\``
    : preferences.githubToken
      ? `**Status**: Not set up yet. Click "Setup RayBuddy" to create your repository.`
      : `**Status**: Add a GitHub token in preferences to enable.`;

  const markdown = `
# Welcome to Agentic Tooling!

This extension integrates Raycast with AI coding agents, allowing you to run AI tasks in isolated sandbox environments directly from your launcher.

## Configuration Required

To get started, you need to configure a few settings. These are stored securely on your device.

1.  **Working Directory**: The folder where the agent will operate and store results.
2.  **Model Name**: The specific model ID (e.g., \`anthropic/claude-3.5-haiku\`).
3.  **OpenRouter API Key**: Your API key for OpenRouter (for model access).
4.  **GitHub Token** (optional): For RayBuddy tool sync across devices.

## RayBuddy - Tool Persistence

RayBuddy automatically creates a private GitHub repository to store your tools. This allows you to:
- Sync tools across multiple machines
- Never lose your created scripts and utilities
- Share tools between Raycast and CLI usage

${raybuddyStatus}

${setupStatus ? `\n> ${setupStatus}` : ""}

## How It Works

Tasks run inside isolated Docker containers with OpenCode as the AI agent. This provides:
- Secure, isolated execution environment
- Full AI coding capabilities
- Automatic cleanup after tasks complete
- Tool persistence via RayBuddy (when configured)

## Next Steps

1. Click **"Open Preferences"** to enter your configuration
2. ${raybuddyConfigured ? "You're all set!" : 'Click **"Setup RayBuddy"** to enable tool sync'}
3. Use the **"Ask Agent"** command to start automating tasks!
  `;

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Open Preferences" onAction={openExtensionPreferences} />
          {preferences.githubToken && !raybuddyConfigured && (
            <Action title="Setup RayBuddy" onAction={handleSetupRayBuddy} shortcut={{ modifiers: ["cmd"], key: "r" }} />
          )}
        </ActionPanel>
      }
      isLoading={isSettingUp}
    />
  );
}
