# Agentic Tooling

Raycast extension and CLI for running AI coding tasks inside an isolated Dockerized OpenCode sandbox using OpenRouter models.

## Components
- **Raycast commands**
  - **Ask Agent** (`src/ask-agent.tsx`): form to submit a prompt (and optional files), writes a per-task runner script, ensures Docker image `agentic-tooling:latest` exists, starts the sandbox via `bun` -> Docker -> `opencode run`, mounts your working directory and `tools/`, logs output, and records task metadata.
  - **View Tasks** (`src/view-tasks.tsx`): polls `.agentic-tasks.json` every 2s, shows status (`running/completed/failed`), timestamps, and log file links; can clear tasks/logs.
  - **Run Tool** (`src/run-tool.tsx`): lists files in `<workingDirectory>/tools`, executes them (`bun run` for .ts/.js, `uv run` for .py, direct exec otherwise), and shows Finder/open actions.
  - **Onboarding** (`src/onboarding.tsx`): quick intro plus shortcut to extension preferences.
- **CLI** (`scripts/cli.ts`): `bun` script with the same Docker + OpenCode flow as Ask Agent; supports context files, timeout, quiet mode, and fallback model.
- **Docker image** (`docker/Dockerfile`): Node 20 base with `bun`, `uv`, `opencode-ai` plus permissive opencode config; built/tagged as `agentic-tooling:latest` automatically if missing.

## Prerequisites
- Docker running locally (used for all executions).
- Node 20+ and `npm` (repo uses `package-lock.json`); `bun` installed on the host (Ask Agent spawns `bun` to run the runner script).
- Raycast installed with the Raycast CLI (`ray`) for lint/build commands.
- OpenRouter API key.

## Setup
1. Install dependencies: `npm install` (from repo root).
2. Optional: pre-build the sandbox image: `npm run docker:build` (otherwise it builds on first run).
3. In Raycast preferences set:
   - **Working Directory** (mounted into Docker and where tasks/logs live)
   - **Model Name** (e.g., `anthropic/claude-3.5-haiku`)
   - **Retry Model** (optional fallback)
   - **OpenRouter API Key**
4. Create a `tools/` folder inside your working directory for reusable scripts; successful runs auto-copy new `.sh/.ts/.js/.py` files from the workspace into `tools/` (chmod 755).
5. Develop the extension with `npm run dev` (Raycast develop) and build with `npm run build`.

## How tasks run (Ask Agent & CLI)
1. Validate preferences and working directory; create `.agentic-logs/` and `.agentic-tasks.json` if missing.
2. Write a task entry (`running`) into `.agentic-tasks.json` and a runner script `.runner-<taskId>.mjs` in the working directory.
3. Ensure Docker is available and the `agentic-tooling:latest` image exists (builds from `docker/Dockerfile` if not).
4. Execute `opencode run` inside Docker with full network, mounting:
   - `/workspace` -> working directory
   - `/tools` (Raycast) or `/workspace/tools` (CLI) as read-only tool cache
   - Environment: `OPENROUTER_API_KEY`, model and retry model
   - Prompt contains tool-reuse guidance and your request; CLI can embed context file contents.
5. Detect refusal patterns; if found and a retry model is set, re-run with the fallback.
6. On success, copy new tool-like files from the workspace into `tools/`; clean up `.opencode` state; mark task status and timestamps; append logs to `.agentic-logs/<taskId>.log`.

## Working directory artifacts
- `.agentic-tasks.json`: task list with status/timestamps/log paths.
- `.agentic-logs/<taskId>.log`: stdout/stderr from each run.
- `.runner-<taskId>.mjs`: transient runner script created per task.
- `tools/`: saved utilities reused by the sandbox (mounted read-only).

## CLI usage
- Run: `bun run scripts/cli.ts [options] <prompt>`
- Options: `-m/--model`, `-r/--retry-model`, `-w/--working-dir`, `-f/--file <path>` (repeatable, inlined into prompt), `-t/--timeout` (ms), `-q/--quiet`.
- Requires `OPENROUTER_API_KEY` env var; builds/uses the same Docker image and tool collection logic as Ask Agent.

## Development commands
- `npm run dev` – Raycast develop mode.
- `npm run build` – Raycast build.
- `npm run lint` / `npm run fix-lint` – lint via `ray lint`.
- `npm run cli -- <args>` – convenience wrapper for the CLI script.