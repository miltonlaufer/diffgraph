import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
import type { DiffMode } from "../core/git/diffProvider.js";
import { runDiff } from "./commands/diff.js";

const execFileAsync = promisify(execFile);
const MAX_ITEMS = 10;
const ESC_KEY = "\u001b";

interface BranchOption {
  name: string;
  date: string;
}

interface CommitOption {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
}

interface PullRequestOption {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
}

const textFromCommand = async (command: string, args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync(command, args, { cwd, maxBuffer: 1024 * 1024 * 20 });
  return stdout;
};

const isExitToken = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.toLowerCase() === "q" || trimmed === ESC_KEY;
};

const parseMenuNumber = (value: string, min: number, max: number): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < min || parsed > max) return null;
  return parsed;
};

const ensureGitRepository = async (repoPath: string): Promise<void> => {
  try {
    const result = (await textFromCommand("git", ["rev-parse", "--is-inside-work-tree"], repoPath)).trim();
    if (result === "true") return;
  } catch {
    // handled below
  }
  throw new Error("No git repository found in current directory. Run this command inside a git repo.");
};

const fetchLatestBranches = async (repoPath: string): Promise<BranchOption[]> => {
  const raw = await textFromCommand(
    "git",
    ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%09%(committerdate:short)", "refs/heads"],
    repoPath,
  );
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_ITEMS)
    .map((line) => {
      const [name, date] = line.split("\t");
      return { name: name ?? "", date: date ?? "" };
    })
    .filter((entry) => entry.name.length > 0);
};

const countBranchDiffFiles = async (
  repoPath: string,
  baseBranch: string,
  targetBranch: string,
): Promise<number> => {
  const raw = await textFromCommand("git", ["diff", "--name-only", "-M", `${baseBranch}...${targetBranch}`], repoPath);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .length;
};

const fetchLatestCommits = async (repoPath: string): Promise<CommitOption[]> => {
  const raw = await textFromCommand(
    "git",
    ["log", "-n", String(MAX_ITEMS), "--date=short", "--pretty=format:%H%x09%h%x09%ad%x09%s"],
    repoPath,
  );
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [hash, shortHash, date, ...subjectParts] = line.split("\t");
      return {
        hash: hash ?? "",
        shortHash: shortHash ?? "",
        date: date ?? "",
        subject: subjectParts.join("\t"),
      };
    })
    .filter((entry) => entry.hash.length > 0);
};

const fetchLatestPullRequests = async (repoPath: string): Promise<PullRequestOption[]> => {
  const raw = await textFromCommand(
    "gh",
    [
      "pr",
      "list",
      "--limit",
      String(MAX_ITEMS),
      "--state",
      "open",
      "--json",
      "number,title,headRefName,baseRefName,updatedAt",
    ],
    repoPath,
  );
  const parsed = JSON.parse(raw) as PullRequestOption[];
  return parsed.slice(0, MAX_ITEMS);
};

const runSelectedDiff = async (repoPath: string, mode: DiffMode): Promise<void> => {
  const result = await runDiff({
    mode,
    repoPath,
    openBrowser: true,
  });
  console.log(`Diff ready at ${result.url}`);
};

const chooseIndex = async (
  question: string,
  totalItems: number,
  ask: (questionText: string) => Promise<string>,
): Promise<number | "exit"> => {
  while (true) {
    const value = await ask(question);
    if (isExitToken(value)) return "exit";
    const idx = parseMenuNumber(value, 1, totalItems);
    if (idx !== null) {
      return idx - 1;
    }
    console.log(`Invalid option. Pick a number between 1 and ${totalItems}, or q/esc to exit.`);
  }
};

export const runInteractiveMenu = async (repoPath: string): Promise<void> => {
  await ensureGitRepository(repoPath);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = async (question: string): Promise<string> => (await rl.question(question)).trim();

  try {
    while (true) {
      console.log("\nDiffGraph menu (q or esc to exit)");
      console.log("1) Staged changes");
      console.log("2) Only staged changes (remember to add files with `git add <file>`)");
      console.log("3) Branch to branch");
      console.log("4) Commit to commit");
      console.log("5) Pull requests");
      console.log("6) File to file");

      const selected = await ask("Select an option [1-6]: ");
      if (isExitToken(selected)) return;
      const option = parseMenuNumber(selected, 1, 6);
      if (option === null) {
        console.log("Invalid option. Use numbers 1-6, or q/esc to exit.");
        continue;
      }

      if (option === 1) {
        await runSelectedDiff(repoPath, { type: "staged", includeUnstaged: true });
        return;
      }
      if (option === 2) {
        await runSelectedDiff(repoPath, { type: "staged", includeUnstaged: false });
        return;
      }
      if (option === 3) {
        const branches = await fetchLatestBranches(repoPath);
        if (branches.length < 2) {
          console.log("Need at least two branches to compare.");
          continue;
        }
        console.log("\nLatest branches:");
        branches.forEach((entry, idx) => {
          console.log(`${idx + 1}) ${entry.name}${entry.date ? ` (${entry.date})` : ""}`);
        });
        const baseIdx = await chooseIndex("Select base branch: ", branches.length, ask);
        if (baseIdx === "exit") return;
        const targetIdx = await chooseIndex("Select target branch: ", branches.length, ask);
        if (targetIdx === "exit") return;
        if (baseIdx === targetIdx) {
          console.log("Base and target branches must be different.");
          continue;
        }
        let baseBranch = branches[baseIdx].name;
        let targetBranch = branches[targetIdx].name;
        const selectedDiffFileCount = await countBranchDiffFiles(repoPath, baseBranch, targetBranch);
        if (selectedDiffFileCount === 0) {
          const reverseDiffFileCount = await countBranchDiffFiles(repoPath, targetBranch, baseBranch);
          if (reverseDiffFileCount > 0) {
            [baseBranch, targetBranch] = [targetBranch, baseBranch];
            console.log(`No results for selected order. Using ${baseBranch} -> ${targetBranch} instead.`);
          }
        }
        await runSelectedDiff(repoPath, {
          type: "branches",
          baseBranch,
          targetBranch,
        });
        return;
      }
      if (option === 4) {
        const commits = await fetchLatestCommits(repoPath);
        if (commits.length < 2) {
          console.log("Need at least two commits to compare.");
          continue;
        }
        console.log("\nLatest commits:");
        commits.forEach((entry, idx) => {
          console.log(`${idx + 1}) ${entry.shortHash} ${entry.date} ${entry.subject}`);
        });
        const oldIdx = await chooseIndex("Select old commit: ", commits.length, ask);
        if (oldIdx === "exit") return;
        const newIdx = await chooseIndex("Select new commit: ", commits.length, ask);
        if (newIdx === "exit") return;
        if (oldIdx === newIdx) {
          console.log("Old and new commits must be different.");
          continue;
        }
        await runSelectedDiff(repoPath, {
          type: "refs",
          oldRef: commits[oldIdx].hash,
          newRef: commits[newIdx].hash,
        });
        return;
      }
      if (option === 5) {
        let prs: PullRequestOption[] = [];
        try {
          prs = await fetchLatestPullRequests(repoPath);
        } catch {
          console.log("Failed to load pull requests. Ensure `gh` is installed and authenticated.");
          continue;
        }
        if (prs.length === 0) {
          console.log("No pull requests found.");
          continue;
        }
        console.log("\nLatest pull requests:");
        prs.forEach((entry, idx) => {
          const updatedDate = entry.updatedAt ? entry.updatedAt.slice(0, 10) : "";
          const refs = `${entry.baseRefName} <- ${entry.headRefName}`;
          console.log(`${idx + 1}) #${entry.number} ${refs} ${updatedDate} ${entry.title}`);
        });
        const prIdx = await chooseIndex("Select pull request: ", prs.length, ask);
        if (prIdx === "exit") return;
        await runSelectedDiff(repoPath, {
          type: "pullRequest",
          prNumber: String(prs[prIdx].number),
        });
        return;
      }

      console.log("\nFile-to-file comparison command:");
      console.log("diffgraph -ff <oldFile> <newFile>");
      console.log("Example: diffgraph -ff src/old.ts src/new.ts");
    }
  } finally {
    rl.close();
  }
};
