import { Action, ActionPanel, Detail, openExtensionPreferences } from "@raycast/api";

export default function Command() {
  const markdown = `
# Welcome to Agentic Tooling!

This extension integrates Raycast with AI coding agents, allowing you to run AI tasks in isolated sandbox environments directly from your launcher.

## Configuration Required

To get started, you need to configure a few settings. These are stored securely on your device.

1.  **Working Directory**: The folder where the agent will operate and store results.
2.  **Model Name**: The specific model ID (e.g., \`anthropic/claude-3.5-haiku\`).
3.  **OpenRouter API Key**: Your API key for OpenRouter (for model access).

## How It Works

Tasks run inside isolated Docker containers with OpenCode as the AI agent. This provides:
- Secure, isolated execution environment
- Full AI coding capabilities
- Automatic cleanup after tasks complete

## Next Steps

Click the **"Open Preferences"** button below to enter your configuration.

Once configured, use the **"Ask Agent"** command to start automating tasks!
  `;

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Open Preferences" onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
