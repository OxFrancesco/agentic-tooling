export interface Task {
  id: string;
  agent: string;
  prompt: string;
  startTime: number;
  endTime?: number;
  status: "running" | "completed" | "failed";
  logFile: string;
}
