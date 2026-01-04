#!/usr/bin/env bun
// @bun

// src/cli.ts
import { rm } from "fs/promises";
import { resolve } from "path";

// src/scanner.ts
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
async function getDirectorySize(dirPath) {
  let size = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += await getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const fileStat = await stat(fullPath);
        size += fileStat.size;
      }
    }
  } catch {}
  return size;
}
async function findNestedNodeModules(rootPath, onFound) {
  const results = [];
  async function scan(currentPath, insideNodeModules) {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue;
      const fullPath = join(currentPath, entry.name);
      if (entry.name === "node_modules") {
        if (insideNodeModules) {
          const dirStat = await stat(fullPath);
          const size = await getDirectorySize(fullPath);
          const info = {
            path: fullPath,
            size,
            modifiedAt: dirStat.mtime
          };
          results.push(info);
          onFound?.(info);
        }
        await scan(fullPath, true);
      } else if (entry.name.startsWith(".")) {
        continue;
      } else {
        await scan(fullPath, insideNodeModules);
      }
    }
  }
  await scan(rootPath, false);
  return results;
}
function sortByAge(results, descending = true) {
  return [...results].sort((a, b) => {
    const diff = a.modifiedAt.getTime() - b.modifiedAt.getTime();
    return descending ? -diff : diff;
  });
}
function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
function formatAge(date) {
  const now = new Date;
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0)
    return "today";
  if (diffDays === 1)
    return "1 day ago";
  if (diffDays < 30)
    return `${diffDays} days ago`;
  if (diffDays < 365)
    return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

// src/cli.ts
var HELP = `
nmc - Node Modules Cleaner

Find and clean nested node_modules directories.

Usage:
  nmc [path] [options]

Options:
  -c, --clean     Clean (delete) found directories
  -y, --yes       Skip confirmation prompt
  -h, --help      Show this help message

Examples:
  nmc                    # Scan current directory
  nmc ~/projects         # Scan specific directory
  nmc --clean            # Scan and delete with confirmation
  nmc --clean --yes      # Scan and delete without confirmation
`;
function parseArgs(args) {
  let path = process.cwd();
  let clean = false;
  let yes = false;
  let help = false;
  for (const arg of args) {
    if (arg === "-c" || arg === "--clean") {
      clean = true;
    } else if (arg === "-y" || arg === "--yes") {
      yes = true;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (!arg.startsWith("-")) {
      path = resolve(arg);
    }
  }
  return { path, clean, yes, help };
}
function printResults(results) {
  if (results.length === 0) {
    console.log(`
\u2728 No nested node_modules directories found.
`);
    return;
  }
  console.log(`
Found ${results.length} nested node_modules:
`);
  const totalSize = results.reduce((sum, r) => sum + r.size, 0);
  for (const result of results) {
    const size = formatSize(result.size).padStart(10);
    const age = formatAge(result.modifiedAt).padStart(15);
    console.log(`  ${size}  ${age}  ${result.path}`);
  }
  console.log(`
  Total: ${formatSize(totalSize)}
`);
}
async function confirmClean() {
  process.stdout.write("Delete these directories? [y/N] ");
  for await (const line of console) {
    const answer = line.trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }
  return false;
}
async function cleanDirectories(results) {
  let cleaned = 0;
  let freedSpace = 0;
  for (const result of results) {
    try {
      await rm(result.path, { recursive: true, force: true });
      cleaned++;
      freedSpace += result.size;
      console.log(`  \u2713 Deleted ${result.path}`);
    } catch (error) {
      console.error(`  \u2717 Failed to delete ${result.path}: ${error}`);
    }
  }
  console.log(`
\uD83E\uDDF9 Cleaned ${cleaned} directories, freed ${formatSize(freedSpace)}
`);
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  console.log(`
\uD83D\uDD0D Scanning for nested node_modules in ${args.path}...
`);
  const results = await findNestedNodeModules(args.path);
  const sorted = sortByAge(results, true);
  printResults(sorted);
  if (sorted.length === 0) {
    process.exit(0);
  }
  if (args.clean) {
    const shouldClean = args.yes || await confirmClean();
    if (shouldClean) {
      await cleanDirectories(sorted);
    } else {
      console.log(`
Aborted.
`);
    }
  }
}
main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
