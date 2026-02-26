#!/usr/bin/env node
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import updateNotifier from "update-notifier";
import { runDiff } from "./commands/diff.js";
import { runAnalyze } from "./commands/analyze.js";
import { runInteractiveMenu } from "./interactive.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = [join(__dirname, "../../../package.json"), join(__dirname, "../../package.json")].find(
  (p) => existsSync(p),
);
const pkg = JSON.parse(readFileSync(pkgPath!, "utf-8")) as { name: string; version: string };
updateNotifier({ pkg }).notify();

const normalizedArgv = process.argv.map((arg) => {
  if (arg === "-ff") return "--file-file";
  if (arg === "-pr") return "--pull-request";
  return arg;
});

const program = new Command();
program.name("diffgraph").description("Graph-aware diff explorer").version(pkg.version);

program
  .command("staged")
  .description("Compare uncommitted changes (staged + unstaged) against HEAD")
  .option("--staged-only", "Use only staged changes")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--no-open", "Do not open browser", false)
  .option("--port <port>", "Server port", "4177")
  .action(async (options) => {
    const includeUnstaged = !options.stagedOnly;
    const result = await runDiff({
      mode: { type: "staged", includeUnstaged },
      repoPath: options.repo,
      openBrowser: options.open !== false,
      port: Number(options.port),
    });
    console.log(`Diff ready at ${result.url}`);
  });

program
  .command("analyze")
  .description("Analyze current repository and persist knowledge graph snapshot")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--ref <ref>", "Reference label", "WORKTREE")
  .action(async (options) => {
    const result = await runAnalyze(options.repo, options.ref);
    console.log(`Saved snapshot ${result.snapshotId} with ${result.count} nodes`);
  });

program
  .option("--file-file <files...>", "Compare two files: -ff <oldFile> <newFile>")
  .option("-b, --branches <branches...>", "Compare two branches: -b <base> <target>")
  .option("-r, --refs <refs...>", "Compare two refs (commit/tag/branch): -r <oldRef> <newRef>")
  .option("--pull-request <number>", "Compare GitHub pull request from origin: -pr <number>")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--no-open", "Do not open browser", false)
  .option("--port <port>", "Server port", "4177")
  .action(async (options) => {
    if (Array.isArray(options.fileFile) && options.fileFile.length === 2) {
      const result = await runDiff({
        mode: {
          type: "files",
          oldFile: options.fileFile[0],
          newFile: options.fileFile[1],
        },
        repoPath: options.repo,
        openBrowser: options.open !== false,
        port: Number(options.port),
      });
      console.log(`Diff ready at ${result.url}`);
      return;
    }

    if (Array.isArray(options.branches) && options.branches.length === 2) {
      const result = await runDiff({
        mode: {
          type: "branches",
          baseBranch: options.branches[0],
          targetBranch: options.branches[1],
        },
        repoPath: options.repo,
        openBrowser: options.open !== false,
        port: Number(options.port),
      });
      console.log(`Diff ready at ${result.url}`);
      return;
    }

    if (Array.isArray(options.refs) && options.refs.length === 2) {
      const result = await runDiff({
        mode: {
          type: "refs",
          oldRef: options.refs[0],
          newRef: options.refs[1],
        },
        repoPath: options.repo,
        openBrowser: options.open !== false,
        port: Number(options.port),
      });
      console.log(`Diff ready at ${result.url}`);
      return;
    }

    if (typeof options.pullRequest === "string" && options.pullRequest.trim().length > 0) {
      const result = await runDiff({
        mode: {
          type: "pullRequest",
          prNumber: options.pullRequest.trim(),
        },
        repoPath: options.repo,
        openBrowser: options.open !== false,
        port: Number(options.port),
      });
      console.log(`Diff ready at ${result.url}`);
      return;
    }

    console.error("Use `staged`, `-ff <oldFile> <newFile>`, `-b <baseBranch> <targetBranch>`, `-r <oldRef> <newRef>`, or `-pr <number>`.");
    process.exitCode = 1;
  });

const hasExplicitArgs = normalizedArgv.length > 2;

const runCli = async (): Promise<void> => {
  if (!hasExplicitArgs) {
    await runInteractiveMenu(process.cwd());
    return;
  }
  await program.parseAsync(normalizedArgv);
};

runCli().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
