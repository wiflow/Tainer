import "server-only";

import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type RunSshCommandInput = {
  destination: string;
  hostKeyOptions: string[];
  input?: string;
  password?: string;
  /** PEM private key used instead of password auth when set. */
  privateKey?: string;
  port?: number;
  /**
   * Send the command verbatim instead of wrapping it in `sh -lc`. Required for
   * restricted remotes (e.g. Hetzner Storage Boxes) that whitelist commands
   * and provide no shell.
   */
  raw?: boolean;
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
  privateKey,
  port,
  raw,
  remoteCommand,
  timeoutMs = 15_000,
}: RunSshCommandInput) {
  const sshPath = await resolveFirstExistingPath(["/usr/bin/ssh", "/bin/ssh"]) ?? "ssh";
  const sshpassPath = await resolveFirstExistingPath(["/usr/bin/sshpass", "/bin/sshpass"]);

  let keyFile: { path: string; cleanup: () => Promise<void> } | null = null;
  if (privateKey) {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "tainer-ssh-key-"));
    const keyPath = path.join(tempDirectory, "id");
    await writeFile(keyPath, privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    keyFile = {
      cleanup: () => rm(tempDirectory, { force: true, recursive: true }),
      path: keyPath,
    };
  }

  const sshArgs = [
    ...hostKeyOptions,
    ...(port ? ["-p", String(port)] : []),
    ...(keyFile
      ? [
          "-i",
          keyFile.path,
          "-o",
          "BatchMode=yes",
          "-o",
          "PreferredAuthentications=publickey",
          "-o",
          "IdentitiesOnly=yes",
        ]
      : [
          "-o",
          "BatchMode=no",
          "-o",
          "NumberOfPasswordPrompts=1",
          "-o",
          "PreferredAuthentications=password,keyboard-interactive",
        ]),
    "-o",
    "ConnectTimeout=5",
    "-o",
    "LogLevel=ERROR",
    destination,
    raw ? remoteCommand : `sh -lc ${shellSingleQuote(remoteCommand)}`,
  ];

  const askpass = sshpassPath || keyFile
    ? null
    : await createAskpassScript(password ?? "");

  const usePassword = !keyFile;
  const command = usePassword && sshpassPath ? sshpassPath : sshPath;
  const args = usePassword && sshpassPath
    ? ["-e", sshPath, ...sshArgs]
    : sshArgs;

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        env: {
          ...process.env,
          ...(askpass?.env ?? {}),
          ...(usePassword && sshpassPath ? { SSHPASS: password ?? "" } : {}),
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
    await keyFile?.cleanup().catch(() => {});
  }
}
