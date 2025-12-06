import { Action, ActionPanel, Color, Icon, List, getPreferenceValues, showToast, Toast } from "@raycast/api";
import fs from "fs";
import path from "path";
import { useState, useEffect } from "react";
import { Task } from "./types";

interface Preferences {
  workingDirectory: string;
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const tasksFile = path.join(preferences.workingDirectory, ".agentic-tasks.json");
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    // Poll for updates every 2 seconds
    const loadTasks = () => {
      if (fs.existsSync(tasksFile)) {
        try {
          const content = fs.readFileSync(tasksFile, "utf-8");
          const data = JSON.parse(content);
          // Sort by startTime desc
          data.sort((a: Task, b: Task) => b.startTime - a.startTime);
          setTasks(data);
        } catch (e) {
          console.error(e);
        }
      }
    };

    loadTasks();
    const interval = setInterval(loadTasks, 2000);
    return () => clearInterval(interval);
  }, [tasksFile]);

  const clearTasks = async () => {
    try {
      if (fs.existsSync(tasksFile)) fs.rmSync(tasksFile);
      const logsDir = path.join(preferences.workingDirectory, ".agentic-logs");
      if (fs.existsSync(logsDir)) fs.rmSync(logsDir, { recursive: true, force: true });
      setTasks([]);
      await showToast({ style: Toast.Style.Success, title: "Tasks cleared" });
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to clear tasks", message: String(e) });
    }
  };

  const getStatusIcon = (status: Task["status"]) => {
    switch (status) {
      case "running":
        return { source: Icon.CircleProgress, tintColor: Color.Blue };
      case "completed":
        return { source: Icon.CheckCircle, tintColor: Color.Green };
      case "failed":
        return { source: Icon.XMarkCircle, tintColor: Color.Red };
    }
  };

  return (
    <List isShowingDetail>
      {tasks.length === 0 ? (
        <List.EmptyView
          title="No tasks found"
          description="Start a task with 'Ask Agent'"
          actions={
            <ActionPanel>
              <Action title="Clear Tasks/Logs" icon={Icon.Trash} onAction={clearTasks} />
            </ActionPanel>
          }
        />
      ) : (
        tasks.map((task) => (
          <List.Item
            key={task.id}
            title={task.prompt}
            subtitle={new Date(task.startTime).toLocaleString()}
            icon={getStatusIcon(task.status)}
            detail={
              <List.Item.Detail
                markdown={`## Task Details
**Status**: ${task.status.toUpperCase()}
**Agent**: ${task.agent}
**ID**: ${task.id}
**Started**: ${new Date(task.startTime).toLocaleString()}
${task.endTime ? `**Ended**: ${new Date(task.endTime).toLocaleString()}` : ""}

### Prompt
${task.prompt}

### Logs
Log file: \`${task.logFile}\`
`}
              />
            }
            actions={
              <ActionPanel>
                <Action.Open title="Open Log File" target={task.logFile} />
                <Action.ShowInFinder path={task.logFile} />
                <Action title="Clear Tasks/Logs" icon={Icon.Trash} onAction={clearTasks} />
                {task.status === "running" && (
                  // Since we don't store PID perfectly reliably or handle permissions nicely, keeping it simple for now.
                  // We could add a 'Kill' action if we stored PID.
                  <Action title="Refresh" onAction={() => {}} />
                )}
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
