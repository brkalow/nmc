import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { cpus } from "node:os";
import { $ } from "bun";

export interface NodeModulesInfo {
  path: string;
  size: number | null;
  modifiedAt: Date;
}

export async function getDirectorySizes(
  dirPaths: string[],
  concurrency = Math.max(1, cpus().length - 1)
): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();
  if (dirPaths.length === 0) return results;

  // Use xargs -P for efficient parallel process management
  // xargs handles process pooling in C, much more efficient than spawning from JS
  const input = dirPaths.join("\n");
  
  try {
    const output = await $`echo ${input} | xargs -P ${concurrency} -I {} du -sk {} 2>/dev/null`.text();
    
    for (const line of output.trim().split("\n")) {
      if (!line) continue;
      const tabIndex = line.indexOf("\t");
      if (tabIndex === -1) continue;
      const kb = parseInt(line.slice(0, tabIndex), 10);
      const path = line.slice(tabIndex + 1);
      results.set(path, kb * 1024);
    }
  } catch {
    // If xargs fails, all sizes remain unknown
  }

  // Mark any paths that weren't resolved as null
  for (const path of dirPaths) {
    if (!results.has(path)) {
      results.set(path, null);
    }
  }

  return results;
}

export async function findNodeModules(
  rootPath: string,
  onFound?: (info: NodeModulesInfo) => void,
  concurrency = Math.max(1, cpus().length - 1)
): Promise<NodeModulesInfo[]> {
  const results: NodeModulesInfo[] = [];
  const queue: string[] = [rootPath];
  let activeWorkers = 0;
  let resolveAll: () => void;
  const allDone = new Promise<void>((resolve) => {
    resolveAll = resolve;
  });

  async function processPath(currentPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    const subdirs: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      const fullPath = join(currentPath, entry.name);

      if (entry.name === "node_modules") {
        const dirStat = await stat(fullPath);
        const info: NodeModulesInfo = {
          path: fullPath,
          size: null,
          modifiedAt: dirStat.mtime,
        };
        results.push(info);
        onFound?.(info);
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

export function sortByAge(results: NodeModulesInfo[], descending = true): NodeModulesInfo[] {
  return [...results].sort((a, b) => {
    const diff = a.modifiedAt.getTime() - b.modifiedAt.getTime();
    return descending ? -diff : diff;
  });
}

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function formatAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
