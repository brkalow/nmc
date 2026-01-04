#!/usr/bin/env bun
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { cpus } from "node:os";
import { $ } from "bun";

const rootPath = process.argv[2] || process.env.HOME || "/";

interface Timing {
  readdirCalls: number;
  readdirTime: number;
  statCalls: number;
  statTime: number;
  duCalls: number;
  duTime: number;
  totalDirs: number;
}

const timing: Timing = {
  readdirCalls: 0,
  readdirTime: 0,
  statCalls: 0,
  statTime: 0,
  duCalls: 0,
  duTime: 0,
  totalDirs: 0,
};

async function timedReaddir(path: string) {
  const start = performance.now();
  timing.readdirCalls++;
  try {
    const result = await readdir(path, { withFileTypes: true });
    timing.readdirTime += performance.now() - start;
    return result;
  } catch {
    timing.readdirTime += performance.now() - start;
    return null;
  }
}

async function timedStat(path: string) {
  const start = performance.now();
  timing.statCalls++;
  try {
    const result = await stat(path);
    timing.statTime += performance.now() - start;
    return result;
  } catch {
    timing.statTime += performance.now() - start;
    return null;
  }
}

async function timedBulkDu(paths: string[]): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();
  if (paths.length === 0) return results;

  const start = performance.now();
  timing.duCalls = 1; // Single xargs invocation
  
  const input = paths.join("\n");
  
  try {
    const output = await $`echo ${input} | xargs -P ${concurrency} -I {} du -sk {} 2>/dev/null`.text();
    timing.duTime = performance.now() - start;
    
    for (const line of output.trim().split("\n")) {
      if (!line) continue;
      const tabIndex = line.indexOf("\t");
      if (tabIndex === -1) continue;
      const kb = parseInt(line.slice(0, tabIndex), 10);
      const path = line.slice(tabIndex + 1);
      results.set(path, kb * 1024);
    }
  } catch {
    timing.duTime = performance.now() - start;
  }

  for (const path of paths) {
    if (!results.has(path)) {
      results.set(path, null);
    }
  }

  return results;
}

interface NodeModulesInfo {
  path: string;
  size: number | null;
  modifiedAt: Date;
}

const concurrency = Math.max(1, cpus().length - 1);

async function findNodeModules(rootPath: string): Promise<NodeModulesInfo[]> {
  const results: NodeModulesInfo[] = [];
  const queue: string[] = [rootPath];
  let activeWorkers = 0;
  let resolveAll: () => void;
  const allDone = new Promise<void>((resolve) => {
    resolveAll = resolve;
  });

  async function processPath(currentPath: string): Promise<void> {
    const entries = await timedReaddir(currentPath);
    if (!entries) return;

    const subdirs: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      timing.totalDirs++;
      const fullPath = join(currentPath, entry.name);

      if (entry.name === "node_modules") {
        const dirStat = await timedStat(fullPath);
        if (dirStat) {
          results.push({
            path: fullPath,
            size: null,
            modifiedAt: dirStat.mtime,
          });
        }
      } else {
        subdirs.push(fullPath);
      }
    }

    queue.push(...subdirs);
  }

  async function worker(): Promise<void> {
    while (true) {
      const path = queue.shift();
      if (!path) break;
      await processPath(path);
    }
    activeWorkers--;
    if (activeWorkers === 0 && queue.length === 0) {
      resolveAll();
    }
  }

  function spawnWorkers(): void {
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

async function main() {
  console.log(`\n🔬 Profiling nmc on: ${rootPath}\n`);
  console.log(`Concurrency: ${Math.max(1, cpus().length - 1)} workers\n`);

  const totalStart = performance.now();

  // Phase 1: Find node_modules
  const scanStart = performance.now();
  const results = await findNodeModules(rootPath);
  const scanTime = performance.now() - scanStart;

  // Phase 2: Get sizes (single bulk du call)
  const sizeStart = performance.now();
  const paths = results.map(r => r.path);
  const sizeMap = await timedBulkDu(paths);
  
  for (const result of results) {
    result.size = sizeMap.get(result.path) ?? null;
  }
  const sizeTime = performance.now() - sizeStart;

  const totalTime = performance.now() - totalStart;

  console.log("=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`Found ${results.length} node_modules directories`);
  console.log(`Scanned ${timing.totalDirs} directories total\n`);

  console.log("=".repeat(60));
  console.log("TIMING BREAKDOWN");
  console.log("=".repeat(60));
  console.log(`\nPhase 1 - Directory Traversal: ${scanTime.toFixed(0)}ms`);
  console.log(`  readdir calls: ${timing.readdirCalls} (${timing.readdirTime.toFixed(0)}ms)`);
  console.log(`  stat calls: ${timing.statCalls} (${timing.statTime.toFixed(0)}ms)`);

  console.log(`\nPhase 2 - Size Calculation: ${sizeTime.toFixed(0)}ms`);
  console.log(`  du calls: ${timing.duCalls} (${timing.duTime.toFixed(0)}ms)`);
  console.log(`  directories processed: ${results.length}`);

  console.log(`\nTotal time: ${totalTime.toFixed(0)}ms\n`);

  console.log("=".repeat(60));
  console.log("ANALYSIS");
  console.log("=".repeat(60));
  const scanPct = ((scanTime / totalTime) * 100).toFixed(1);
  const sizePct = ((sizeTime / totalTime) * 100).toFixed(1);
  console.log(`\nDirectory traversal: ${scanPct}% of total time`);
  console.log(`Size calculation:    ${sizePct}% of total time`);

  if (sizeTime > scanTime) {
    console.log(`\n⚠️  BOTTLENECK: Size calculation`);
    const avgTime = sizeTime / results.length;
    console.log(`   Average size calc: ${avgTime.toFixed(0)}ms per node_modules`);
  } else {
    console.log(`\n✅ Size calculation is now faster than directory traversal!`);
    console.log(`   Average readdir time: ${(timing.readdirTime / timing.readdirCalls).toFixed(1)}ms per call`);
  }
  console.log();
}

main().catch(console.error);
