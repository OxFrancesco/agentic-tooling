#!/usr/bin/env bun
/**
 * Test script for Daytona + OpenCode integration
 * Usage: DAYTONA_API_KEY=key OPENROUTER_API_KEY=key bun run test/test-daytona-opencode.ts
 */

import { Daytona } from "@daytonaio/sdk";

async function main() {
  const apiKey = process.env.DAYTONA_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    console.error("Error: DAYTONA_API_KEY environment variable is required");
    process.exit(1);
  }
  if (!openRouterKey) {
    console.error("Error: OPENROUTER_API_KEY environment variable is required");
    process.exit(1);
  }

  // Use OpenRouter provider format
  const model = process.env.MODEL || "openrouter/anthropic/claude-3.5-haiku";
  const prompt = process.argv[2] || "Download this video https://www.youtube.com/watch?v=CvXsGWDozRw";

  console.log("=== Daytona + OpenCode Test ===");
  console.log(`Prompt: ${prompt}`);
  console.log(`Model: ${model}`);
  console.log("");

  try {
    console.log("Creating Daytona sandbox...");
    const daytona = new Daytona({ apiKey });
    const sandbox = await daytona.create({ language: "typescript" });
    console.log(`Sandbox created: ${sandbox.id || "unknown"}`);

    console.log("Installing opencode via npm...");
    const installRes = await sandbox.process.executeCommand("npm install -g opencode-ai 2>&1");
    const installOutput = (installRes as any)?.result || (installRes as any)?.stdout || "";
    console.log("Install output:", installOutput);
    
    // Check where opencode was installed
    const whichRes = await sandbox.process.executeCommand("which opencode || echo 'not found'");
    console.log("Opencode location:", (whichRes as any)?.result || (whichRes as any)?.stdout || "unknown");

    // Build the command with OpenRouter API key
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const command = `OPENROUTER_API_KEY='${openRouterKey}' opencode run --model '${model}' '${escapedPrompt}' --print-logs 2>&1`;
    
    console.log("Running opencode...");
    console.log(`Command: ${command}`);
    console.log("");
    
    const result = await sandbox.process.executeCommand(command);
    const exitCode = (result as any)?.exitCode ?? (result as any)?.exit_code ?? 0;
    const output = (result as any)?.stdout || (result as any)?.result || "";
    
    console.log("=== OpenCode Output ===");
    console.log(output);
    console.log("");
    console.log(`Exit code: ${exitCode}`);

    console.log("Cleaning up sandbox...");
    await sandbox.delete();
    console.log("Sandbox deleted");

    process.exit(exitCode);
  } catch (err: any) {
    console.error("Error:", err?.message || err);
    process.exit(1);
  }
}

main();
