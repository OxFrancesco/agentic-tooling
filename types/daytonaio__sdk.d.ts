declare module "@daytonaio/sdk" {
  export interface DaytonaOptions {
    apiKey: string;
  }

  export interface CommandResult {
    exit_code?: number;
    exitCode?: number;
    result?: string;
    stdout?: string;
    stderr?: string;
  }

  export interface DaytonaProcess {
    codeRun(code: string): Promise<CommandResult>;
    executeCommand(command: string): Promise<CommandResult>;
  }

  export interface DaytonaSandbox {
    id?: string;
    process: DaytonaProcess;
    delete(): Promise<void>;
  }

  export class Daytona {
    constructor(options: DaytonaOptions);
    create(options?: Record<string, unknown>): Promise<DaytonaSandbox>;
  }
}

