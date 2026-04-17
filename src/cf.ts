import { spawn } from "node:child_process";

export interface CfExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CfRunnerOptions {
  env?: NodeJS.ProcessEnv;
}

export interface CfRunner {
  exec(args: string[], opts?: { input?: string; silent?: boolean }): Promise<CfExecResult>;
}

export function createCfRunner(options: CfRunnerOptions = {}): CfRunner {
  return {
    exec: (args, opts = {}) =>
      new Promise<CfExecResult>((resolvePromise, rejectPromise) => {
        const child = spawn("cf", args, {
          env: { ...process.env, ...options.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on("error", (err) => {
          rejectPromise(
            new Error(`Failed to spawn 'cf' CLI: ${err.message}. Is cf installed?`, { cause: err }),
          );
        });

        child.on("close", (code) => {
          resolvePromise({ stdout, stderr, exitCode: code ?? 1 });
        });

        if (opts.input !== undefined) {
          child.stdin.write(opts.input);
          child.stdin.end();
        } else {
          child.stdin.end();
        }
      }),
  };
}

export async function cfTarget(cf: CfRunner): Promise<string | undefined> {
  const result = await cf.exec(["target"]);
  if (result.exitCode !== 0) return undefined;
  return result.stdout;
}

export async function cfApi(cf: CfRunner, endpoint: string): Promise<void> {
  const result = await cf.exec(["api", endpoint]);
  if (result.exitCode !== 0) {
    throw new Error(`cf api ${endpoint} failed: ${result.stderr || result.stdout}`);
  }
}

export async function cfAuth(cf: CfRunner, email: string, password: string): Promise<void> {
  const result = await cf.exec(["auth", email, password]);
  if (result.exitCode !== 0) {
    throw new Error(`cf auth failed: ${result.stderr || result.stdout}`);
  }
}

export async function cfSetTarget(cf: CfRunner, org: string, space: string): Promise<void> {
  const result = await cf.exec(["target", "-o", org, "-s", space]);
  if (result.exitCode !== 0) {
    throw new Error(
      `cf target -o ${org} -s ${space} failed: ${result.stderr || result.stdout}`.trim(),
    );
  }
}

export async function cfAppGuid(cf: CfRunner, app: string): Promise<string> {
  const result = await cf.exec(["app", app, "--guid"]);
  if (result.exitCode !== 0) {
    throw new Error(`cf app ${app} --guid failed: ${result.stderr || result.stdout}`.trim());
  }
  const guid = result.stdout.trim();
  if (!guid) {
    throw new Error(`cf app ${app} --guid returned empty output`);
  }
  return guid;
}

export async function cfCurl<T = unknown>(cf: CfRunner, path: string): Promise<T> {
  const result = await cf.exec(["curl", path]);
  if (result.exitCode !== 0) {
    throw new Error(`cf curl ${path} failed: ${result.stderr || result.stdout}`.trim());
  }
  return JSON.parse(result.stdout) as T;
}
