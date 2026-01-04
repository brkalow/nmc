#!/usr/bin/env bun
import { resolve, relative } from "node:path";
import {
  findNodeModules,
  getDirectorySizes,
  sortByAge,
  formatSize,
  formatAge,
  type NodeModulesInfo,
} from "./scanner";

const HELP = `
nmc - Node Modules Cleaner

Find and clean node_modules directories.

Usage:
  nmc [path] [options]

Options:
  -c, --clean         Clean (delete) found directories
  -y, --yes           Skip confirmation prompt
  -o, --older <days>  Only show directories older than N days
  -s, --size          Sort by size (largest first) instead of age
  -h, --help          Show this help message

Examples:
  nmc                      # Scan current directory
  nmc ~/projects           # Scan specific directory
  nmc --older 30           # Only show dirs older than 30 days
  nmc --clean              # Scan and delete with confirmation
  nmc --clean --yes        # Scan and delete without confirmation
  nmc -o 90 -c -y          # Delete dirs older than 90 days
`;

export function parseArgs(args: string[]): {
  path: string;
  clean: boolean;
  yes: boolean;
  help: boolean;
  olderThan: number | null;
  sortBySize: boolean;
} {
  let path = process.cwd();
  let clean = false;
  let yes = false;
  let help = false;
  let olderThan: number | null = null;
  let sortBySize = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-c" || arg === "--clean") {
      clean = true;
    } else if (arg === "-y" || arg === "--yes") {
      yes = true;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "-s" || arg === "--size") {
      sortBySize = true;
    } else if (arg === "-o" || arg === "--older") {
      const next = args[++i];
      if (next) {
        olderThan = parseInt(next, 10);
      }
    } else if (!arg.startsWith("-")) {
      path = resolve(arg);
    }
  }

  return { path, clean, yes, help, olderThan, sortBySize };
}

async function populateSizes(results: NodeModulesInfo[]): Promise<void> {
  const paths = results.map((r) => r.path);
  const sizes = await getDirectorySizes(paths);
  for (const result of results) {
    result.size = sizes.get(result.path) ?? null;
  }
}

function sortBySize(results: NodeModulesInfo[]): NodeModulesInfo[] {
  return [...results].sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
}

function printResults(results: NodeModulesInfo[], rootPath: string): void {
  if (results.length === 0) {
    console.log("\n✨ No node_modules directories found.\n");
    return;
  }

  console.log(`\nFound ${results.length} node_modules:\n`);

  const totalSize = results.reduce((sum, r) => sum + (r.size ?? 0), 0);

  for (const result of results) {
    const size = (
      result.size !== null ? formatSize(result.size) : "?"
    ).padStart(10);
    const age = formatAge(result.modifiedAt).padStart(15);
    const relPath = relative(rootPath, result.path);
    console.log(`  ${size}  ${age}  ${relPath}`);
  }

  console.log(`\n  Total: ${formatSize(totalSize)}\n`);
}

async function confirmClean(): Promise<boolean> {
  process.stdout.write("Delete these directories? [y/N] ");

  for await (const line of console) {
    const answer = line.trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }

  return false;
}

async function cleanDirectories(results: NodeModulesInfo[]): Promise<void> {
  if (results.length === 0) return;

  const { cpus } = await import("node:os");
  const { $ } = await import("bun");
  const concurrency = Math.max(1, cpus().length - 1);

  const paths = results.map((r) => r.path);
  const input = paths.join("\n");

  try {
    await $`echo ${input} | xargs -P ${concurrency} -I {} rm -rf {}`.quiet();
  } catch {
    // xargs may return non-zero if some deletions fail
  }

  const freedSpace = results.reduce((sum, r) => sum + (r.size ?? 0), 0);
  console.log(
    `\n🧹 Cleaned ${results.length} directories, freed ${formatSize(
      freedSpace
    )}\n`
  );
}

function filterByAge(
  results: NodeModulesInfo[],
  olderThanDays: number
): NodeModulesInfo[] {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return results.filter((r) => r.modifiedAt < cutoff);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  console.log(`\n🔍 Scanning for node_modules in ${args.path}...\n`);

  const results = await findNodeModules(args.path);
  await populateSizes(results);

  const sorted = args.sortBySize
    ? sortBySize(results)
    : sortByAge(results, true);
  const filtered =
    args.olderThan !== null ? filterByAge(sorted, args.olderThan) : sorted;

  if (args.olderThan !== null) {
    console.log(
      `Filtering to directories older than ${args.olderThan} days...\n`
    );
  }

  printResults(filtered, args.path);

  if (filtered.length === 0) {
    process.exit(0);
  }

  if (args.clean) {
    const shouldClean = args.yes || (await confirmClean());

    if (shouldClean) {
      await cleanDirectories(filtered);
    } else {
      console.log("\nAborted.\n");
    }
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
