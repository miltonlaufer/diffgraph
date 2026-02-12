#!/usr/bin/env node
import { Command } from "commander";
import { runDiff } from "./commands/diff.js";
import { runAnalyze } from "./commands/analyze.js";

const normalizedArgv = process.argv.map((arg) => (arg === "-ff" ? "--file-file" : arg));

const program = new Command();
program.name("diffgraph").description("Graph-aware diff explorer").version("0.1.0");

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

    console.error("Use `staged`, `-ff <oldFile> <newFile>`, or `-b <baseBranch> <targetBranch>`.");
    process.exitCode = 1;
  });

program.parseAsync(normalizedArgv).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
