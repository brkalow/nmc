import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findNodeModules,
  sortByAge,
  formatSize,
  formatAge,
  getDirectorySizes,
  type NodeModulesInfo,
} from "./scanner";
import { parseArgs } from "./cli";

const TEST_DIR = join(tmpdir(), `nmc-test-${Date.now()}`);

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("parseArgs", () => {
  test("returns defaults when no args", () => {
    const result = parseArgs([]);
    expect(result.clean).toBe(false);
    expect(result.yes).toBe(false);
    expect(result.help).toBe(false);
  });

  test("parses --clean flag", () => {
    expect(parseArgs(["--clean"]).clean).toBe(true);
    expect(parseArgs(["-c"]).clean).toBe(true);
  });

  test("parses --yes flag", () => {
    expect(parseArgs(["--yes"]).yes).toBe(true);
    expect(parseArgs(["-y"]).yes).toBe(true);
  });

  test("parses --help flag", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("parses path argument", () => {
    const result = parseArgs(["/some/path"]);
    expect(result.path).toBe("/some/path");
  });

  test("parses combined flags", () => {
    const result = parseArgs(["-c", "-y", "/my/path"]);
    expect(result.clean).toBe(true);
    expect(result.yes).toBe(true);
    expect(result.path).toBe("/my/path");
  });
});

describe("findNodeModules", () => {
  test("finds node_modules directory", async () => {
    const projectDir = join(TEST_DIR, "project1");
    const nodeModulesDir = join(projectDir, "node_modules");
    await mkdir(nodeModulesDir, { recursive: true });
    await writeFile(join(nodeModulesDir, "package.json"), "{}");

    const results = await findNodeModules(TEST_DIR);
    const found = results.find((r) => r.path === nodeModulesDir);

    expect(found).toBeDefined();
    expect(found!.path).toBe(nodeModulesDir);
    expect(found!.modifiedAt).toBeInstanceOf(Date);
  });

  test("finds multiple node_modules directories", async () => {
    const project2 = join(TEST_DIR, "project2", "node_modules");
    const project3 = join(TEST_DIR, "project3", "node_modules");
    await mkdir(project2, { recursive: true });
    await mkdir(project3, { recursive: true });

    const results = await findNodeModules(TEST_DIR);

    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test("does not descend into node_modules", async () => {
    const nestedDir = join(TEST_DIR, "project4", "node_modules", "dep", "node_modules");
    await mkdir(nestedDir, { recursive: true });

    const results = await findNodeModules(TEST_DIR);
    const nested = results.find((r) => r.path === nestedDir);

    expect(nested).toBeUndefined();
  });

  test("skips hidden directories", async () => {
    const hiddenDir = join(TEST_DIR, ".hidden", "node_modules");
    await mkdir(hiddenDir, { recursive: true });

    const results = await findNodeModules(TEST_DIR);
    const found = results.find((r) => r.path === hiddenDir);

    expect(found).toBeUndefined();
  });

  test("calls onFound callback", async () => {
    const found: NodeModulesInfo[] = [];
    await findNodeModules(TEST_DIR, (info) => found.push(info));

    expect(found.length).toBeGreaterThan(0);
  });

  test("returns empty array for non-existent directory", async () => {
    const results = await findNodeModules("/non/existent/path");
    expect(results).toEqual([]);
  });
});

describe("sortByAge", () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const items: NodeModulesInfo[] = [
    { path: "/old", size: null, modifiedAt: lastWeek },
    { path: "/new", size: null, modifiedAt: now },
    { path: "/mid", size: null, modifiedAt: yesterday },
  ];

  test("sorts by age descending (newest first)", () => {
    const sorted = sortByAge(items, true);
    expect(sorted[0].path).toBe("/new");
    expect(sorted[1].path).toBe("/mid");
    expect(sorted[2].path).toBe("/old");
  });

  test("sorts by age ascending (oldest first)", () => {
    const sorted = sortByAge(items, false);
    expect(sorted[0].path).toBe("/old");
    expect(sorted[1].path).toBe("/mid");
    expect(sorted[2].path).toBe("/new");
  });

  test("does not mutate original array", () => {
    const original = [...items];
    sortByAge(items, true);
    expect(items).toEqual(original);
  });
});

describe("formatSize", () => {
  test("formats bytes", () => {
    expect(formatSize(0)).toBe("0.0 B");
    expect(formatSize(500)).toBe("500.0 B");
  });

  test("formats kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
  });

  test("formats megabytes", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  test("formats gigabytes", () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatSize(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });
});

describe("formatAge", () => {
  test("formats today", () => {
    const now = new Date();
    expect(formatAge(now)).toBe("today");
  });

  test("formats 1 day ago", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(formatAge(yesterday)).toBe("1 day ago");
  });

  test("formats days ago", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    expect(formatAge(fiveDaysAgo)).toBe("5 days ago");
  });

  test("formats months ago", () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(formatAge(twoMonthsAgo)).toBe("2 months ago");
  });

  test("formats years ago", () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
    expect(formatAge(twoYearsAgo)).toBe("2 years ago");
  });
});

describe("getDirectorySizes", () => {
  test("returns size for existing directory", async () => {
    const dir = join(TEST_DIR, "size-test");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "file.txt"), "hello world");

    const sizes = await getDirectorySizes([dir]);
    const size = sizes.get(dir);
    expect(size).toBeGreaterThan(0);
  });

  test("returns null for non-existent directory", async () => {
    const sizes = await getDirectorySizes(["/non/existent/path"]);
    const size = sizes.get("/non/existent/path");
    expect(size).toBeNull();
  });

  test("returns sizes for multiple directories", async () => {
    const dir1 = join(TEST_DIR, "size-test-1");
    const dir2 = join(TEST_DIR, "size-test-2");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await writeFile(join(dir1, "file.txt"), "hello");
    await writeFile(join(dir2, "file.txt"), "world");

    const sizes = await getDirectorySizes([dir1, dir2]);
    expect(sizes.get(dir1)).toBeGreaterThan(0);
    expect(sizes.get(dir2)).toBeGreaterThan(0);
  });
});
