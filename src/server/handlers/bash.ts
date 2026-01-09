// Bash execution handlers for remote CLI

export interface BashExecuteParams {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface BashExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GetCwdResult {
  cwd: string;
}

export async function handleBashExecute(params: BashExecuteParams): Promise<BashExecuteResult> {
  if (!params.command) {
    throw new Error("Missing command parameter");
  }
  const cwd = params.cwd || process.cwd();
  const timeout = params.timeout || 30000;

  try {
    const proc = Bun.spawn(["bash", "-c", params.command], {
      stdout: "pipe",
      stderr: "pipe",
      cwd,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    const [stdout, stderr] = await Promise.race([
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]),
      timeoutPromise,
    ]);

    const exitCode = await proc.exited;

    return {
      stdout,
      stderr,
      exitCode,
    };
  } catch (err) {
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    };
  }
}

export function handleGetCwd(): GetCwdResult {
  return { cwd: process.cwd() };
}
