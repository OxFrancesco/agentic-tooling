import { Action, ActionPanel, List, getPreferenceValues, showToast, Toast } from "@raycast/api";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { useState, useEffect } from "react";

interface Preferences {
  workingDirectory: string;
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const toolsDir = path.join(preferences.workingDirectory, "tools");

  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    if (fs.existsSync(toolsDir)) {
      try {
        const fileList = fs.readdirSync(toolsDir).filter((f) => !f.startsWith("."));
        setFiles(fileList);
      } catch (e) {
        console.error(e);
      }
    }
  }, [toolsDir]);

  async function runScript(filename: string) {
    const filePath = path.join(toolsDir, filename);
    await showToast({ style: Toast.Style.Animated, title: "Running tool..." });

    // Auto-detect runner based on extension? Or just exec?
    // User mentioned "bun script or uv script".
    // Let's try to assume executable binary or use 'bun' if .ts/.js
    let cmd = `"${filePath}"`;
    if (filename.endsWith(".ts") || filename.endsWith(".js")) {
      // Prefer bun if user has it, or node.
      // For now let's try 'bun run'
      cmd = `bun run "${filePath}"`;
    } else if (filename.endsWith(".py")) {
      cmd = `uv run "${filePath}"`; // As per user mention of uv
    }

    exec(cmd, { cwd: preferences.workingDirectory }, async (error, stdout, stderr) => {
      if (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Tool failed",
          message: stderr || error.message,
        });
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: "Tool finished",
          message: stdout ? "Check output" : "Done",
        });
      }
    });
  }

  return (
    <List>
      {files.length === 0 ? (
        <List.EmptyView title="No tools found" description={`Create scripts in ${toolsDir} to see them here.`} />
      ) : (
        files.map((file) => (
          <List.Item
            key={file}
            title={file}
            actions={
              <ActionPanel>
                <Action title="Run Tool" onAction={() => runScript(file)} />
                <Action.ShowInFinder path={path.join(toolsDir, file)} />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
