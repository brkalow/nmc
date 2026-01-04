#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __require = import.meta.require;

// src/cli.ts
import { resolve, relative } from "path";

// src/scanner.ts
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { cpus } from "os";
var {$ } = globalThis.Bun;
async function getDirectorySizes(dirPaths, concurrency = Math.max(1, cpus().length - 1)) {
  const results = new Map;
  if (dirPaths.length === 0)
    return results;
  const input = dirPaths.join(`
`);
  try {
    const output = await $`echo ${input} | xargs -P ${concurrency} -I {} du -sk {} 2>/dev/null`.text();
    for (const line of output.trim().split(`
`)) {
      if (!line)
        continue;
      const tabIndex = line.indexOf("\t");
      if (tabIndex === -1)
        continue;
      const kb = parseInt(line.slice(0, tabIndex), 10);
      const path = line.slice(tabIndex + 1);
      results.set(path, kb * 1024);
    }
  } catch {}
  for (const path of dirPaths) {
    if (!results.has(path)) {
      results.set(path, null);
    }
  }
  return results;
}
async function findNodeModules(rootPath, onFound, concurrency = Math.max(1, cpus().length - 1)) {
  const results = [];
  const queue = [rootPath];
  let activeWorkers = 0;
  let resolveAll;
  const allDone = new Promise((resolve) => {
    resolveAll = resolve;
  });
  async function processPath(currentPath) {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs = [];
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue;
      if (entry.name.startsWith("."))
        continue;
      const fullPath = join(currentPath, entry.name);
      if (entry.name === "node_modules") {
        const dirStat = await stat(fullPath);
        const info = {
          path: fullPath,
          size: null,
          modifiedAt: dirStat.mtime
        };
        results.push(info);
        onFound?.(info);
      } else {
        subdirs.push(fullPath);
      }
    }
    queue.push(...subdirs);
  }
  async function worker() {
    while (true) {
      const path = queue.shift();
      if (!path)
        break;
      await processPath(path);
    }
    activeWorkers--;
    if (activeWorkers === 0 && queue.length === 0) {
      resolveAll();
    }
  }
  function spawnWorkers() {
    while (activeWorkers < concurrency && queue.length > 0) {
      activeWorkers++;
      worker().then(() => {
        if (queue.length > 0) {
          spawnWorkers();
        }
      });
    }
  }
  spawnWorkers();
  await allDone;
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
function parseArgs(args) {
  let path = process.cwd();
  let clean = false;
  let yes = false;
  let help = false;
  let olderThan = null;
  let sortBySize = false;
  for (let i = 0;i < args.length; i++) {
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
async function populateSizes(results) {
  const paths = results.map((r) => r.path);
  const sizes = await getDirectorySizes(paths);
  for (const result of results) {
    result.size = sizes.get(result.path) ?? null;
  }
}
function sortBySize(results) {
  return [...results].sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
}
function printResults(results, rootPath) {
  if (results.length === 0) {
    console.log(`
\u2728 No node_modules directories found.
`);
    return;
  }
  console.log(`
Found ${results.length} node_modules:
`);
  const totalSize = results.reduce((sum, r) => sum + (r.size ?? 0), 0);
  for (const result of results) {
    const size = (result.size !== null ? formatSize(result.size) : "?").padStart(10);
    const age = formatAge(result.modifiedAt).padStart(15);
    const relPath = relative(rootPath, result.path);
    console.log(`  ${size}  ${age}  ${relPath}`);
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
  if (results.length === 0)
    return;
  const { cpus: cpus2 } = await import("os");
  const { $: $2 } = await Promise.resolve(globalThis.Bun);
  const concurrency = Math.max(1, cpus2().length - 1);
  const paths = results.map((r) => r.path);
  const input = paths.join(`
`);
  try {
    await $2`echo ${input} | xargs -P ${concurrency} -I {} rm -rf {}`.quiet();
  } catch {}
  const freedSpace = results.reduce((sum, r) => sum + (r.size ?? 0), 0);
  console.log(`
\uD83E\uDDF9 Cleaned ${results.length} directories, freed ${formatSize(freedSpace)}
`);
}
function filterByAge(results, olderThanDays) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return results.filter((r) => r.modifiedAt < cutoff);
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  console.log(`
\uD83D\uDD0D Scanning for node_modules in ${args.path}...
`);
  const results = await findNodeModules(args.path);
  await populateSizes(results);
  const sorted = args.sortBySize ? sortBySize(results) : sortByAge(results, true);
  const filtered = args.olderThan !== null ? filterByAge(sorted, args.olderThan) : sorted;
  if (args.olderThan !== null) {
    console.log(`Filtering to directories older than ${args.olderThan} days...
`);
  }
  printResults(filtered, args.path);
  if (filtered.length === 0) {
    process.exit(0);
  }
  if (args.clean) {
    const shouldClean = args.yes || await confirmClean();
    if (shouldClean) {
      await cleanDirectories(filtered);
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
export {
  parseArgs
};
