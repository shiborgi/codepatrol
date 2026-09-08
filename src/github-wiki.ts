import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { runProcess } from "./rpc.js";

export interface WikiPage {
  path: string;
  body: string;
}
export interface GitHubWikiAdapter {
  inspect(marker: string): Promise<WikiPage[]>;
  upsert(page: {
    marker: string;
    path: string;
    title: string;
    body: string;
  }): Promise<"created" | "updated" | "unchanged">;
  close(): Promise<void>;
}

/** A deliberately small Git wiki client. Credentials stay in the child environment. */
export class GitHubWikiClient implements GitHubWikiAdapter {
  private directory?: string;
  private branch?: string;
  constructor(
    private readonly repository: string,
    private readonly token: string,
  ) {}
  private async checkout() {
    if (this.directory) return this.directory;
    const directory = await mkdtemp(join(tmpdir(), "codepatrol-wiki-"));
    const askpass = join(directory, `askpass-${randomUUID()}.sh`);
    await writeFile(askpass, "#!/bin/sh\nprintf '%s' \"$GITHUB_TOKEN\"\n", {
      mode: 0o700,
    });
    await chmod(askpass, 0o700);
    const env = {
      ...process.env,
      GITHUB_TOKEN: this.token,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
    };
    const limits = { timeoutMs: 120_000, maxOutputBytes: 1_048_576 };
    try {
      await runProcess(
        [
          "git",
          "clone",
          "--quiet",
          `https://github.com/${this.repository}.wiki.git`,
          directory,
        ],
        { cwd: tmpdir(), limits, env },
      );
      this.branch = (
        await runProcess(
          ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
          { cwd: directory, limits },
        )
      )
        .trim()
        .replace(/^origin\//, "");
      this.directory = directory;
      return directory;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async inspect(marker: string): Promise<WikiPage[]> {
    const directory = await this.checkout();
    const pages: WikiPage[] = [];
    const visit = async (path: string): Promise<void> => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory() && entry.name !== ".git") await visit(child);
        else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          const body = await readFile(child, "utf8");
          if (body.includes(marker))
            pages.push({ path: relative(directory, child), body });
        }
      }
    };
    await visit(directory);
    return pages;
  }
  async upsert(page: { marker: string; path: string; title: string; body: string }) {
    const directory = await this.checkout();
    const matches = await this.inspect(page.marker);
    if (matches.length > 1)
      throw new Error(`Duplicate GitHub wiki marker: ${page.marker}`);
    const path = matches[0]?.path ?? `codepatrol-${page.marker.slice(-16)}.md`;
    const next = `# ${page.title}\n\n${page.body}\n`;
    if (matches[0]?.body === next) return "unchanged";
    await writeFile(join(directory, path), next, { mode: 0o600 });
    await runProcess(["git", "add", "--", path], {
      cwd: directory,
      limits: { timeoutMs: 120_000, maxOutputBytes: 1_048_576 },
    });
    await runProcess(
      [
        "git",
        "-c",
        "user.name=CodePatrol",
        "-c",
        "user.email=codepatrol@users.noreply.github.com",
        "commit",
        "--quiet",
        "-m",
        "codepatrol wiki sync",
      ],
      { cwd: directory, limits: { timeoutMs: 120_000, maxOutputBytes: 1_048_576 } },
    );
    await runProcess(["git", "push", "origin", `HEAD:${this.branch}`], {
      cwd: directory,
      limits: { timeoutMs: 120_000, maxOutputBytes: 1_048_576 },
    });
    return matches.length ? "updated" : "created";
  }
  async close() {
    if (this.directory)
      await rm(dirname(this.directory), { recursive: true, force: true });
    this.directory = undefined;
  }
}
