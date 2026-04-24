import "server-only";

import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type RunSshCommandInput = {
  destination: string;
  hostKeyOptions: string[];
  input?: string;
  password: string;
  remoteCommand: string;
  timeoutMs?: number;
};

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveFirstExistingPath(paths: string[]) {
  for (const candidate of paths) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function createAskpassScript(password: string) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "tainer-ssh-askpass-"));
  const scriptPath = path.join(tempDirectory, "askpass.sh");

  await writeFile(
    scriptPath,
    "#!/bin/sh\nprintf '%s\\n' \"$TAINER_SSH_PASSWORD\"\n",
    { encoding: "utf8", mode: 0o700 },
  );
  await chmod(scriptPath, 0o700);

  return {
    cleanup: () => rm(tempDirectory, { force: true, recursive: true }),
    env: {
      DISPLAY: "tainer:0",
      SSH_ASKPASS: scriptPath,
      SSH_ASKPASS_REQUIRE: "force",
      TAINER_SSH_PASSWORD: password,
    },
  };
}

export async function runSshCommand({
  destination,
  hostKeyOptions,
  input,
  password,
  remoteCommand,
  timeoutMs = 15_000,
}: RunSshCommandInput) {
  const sshPath = await resolveFirstExistingPath(["/usr/bin/ssh", "/bin/ssh"]) ?? "ssh";
  const sshpassPath = await resolveFirstExistingPath(["/usr/bin/sshpass", "/bin/sshpass"]);
  const sshArgs = [
    ...hostKeyOptions,
    "-o",
    "BatchMode=no",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "LogLevel=ERROR",
    "-o",
    "NumberOfPasswordPrompts=1",
    "-o",
    "PreferredAuthentications=password,keyboard-interactive",
    destination,
    `sh -lc ${shellSingleQuote(remoteCommand)}`,
  ];

  const askpass = sshpassPath
    ? null
    : await createAskpassScript(password);

  const command = sshpassPath ?? sshPath;
  const args = sshpassPath
    ? ["-e", sshPath, ...sshArgs]
    : sshArgs;

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        env: {
          ...process.env,
          ...(askpass?.env ?? {}),
          ...(sshpassPath ? { SSHPASS: password } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill("SIGKILL");
        reject(new Error("Timed out while running an SSH command."));
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        reject(error);
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (code === 0) {
          resolve(stdout);
          return;
        }

        reject(
          new Error(
            stderr.trim() || `SSH command exited with status ${code ?? "unknown"}.`,
          ),
        );
      });

      if (input != null) {
        child.stdin.end(input);
        return;
      }

      child.stdin.end();
    });
  } finally {
    await askpass?.cleanup().catch(() => {});
  }
}
