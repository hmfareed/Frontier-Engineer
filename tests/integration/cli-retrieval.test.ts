import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateValueAgainstSchema } from "../../scripts/lib/json-config.ts";
import { repoRoot } from "../../scripts/lib/paths.ts";
import { ConnectionManager } from "../../scripts/storage/connection-manager.ts";
import { StorageManager } from "../../scripts/storage/transactions/storage-manager.ts";
import type { FileInventoryResult } from "../../scripts/scanner/types.ts";

const root = repoRoot();

describe("CLI Integration: frontier retrieve", () => {
  const cliPath = path.resolve(root, "scripts", "cli", "frontier-cli.ts");
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function runCliProc(args: string[]) {
    return spawnSync(process.execPath, [cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  async function seedWorkspace(): Promise<string> {
    const ws = makeTempDir("fe-cli-retrieve-");
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "package.json"),
      JSON.stringify({ name: "cli-ret-repo" }),
      "utf8",
    );
    const filePath = path.join(ws, "src", "service.ts");
    fs.writeFileSync(filePath, "export function runService() { return 42; }\n", "utf8");
    const fixedTime = new Date(1700000000000);
    fs.utimesSync(filePath, fixedTime, fixedTime);
    const stat = fs.statSync(filePath);

    const cm = new ConnectionManager({ workspaceRoot: ws });
    const sm = new StorageManager(cm);
    await sm.initialize();

    const inventory: FileInventoryResult = {
      workspaceRoot: ws,
      scannedAt: new Date(1700000001000).toISOString(),
      scanStatus: "COMPLETE",
      files: [
        {
          canonicalPath: "src/service.ts",
          fileExtension: ".ts",
          classification: "source",
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          contentHash: "h_srv",
          hashState: "COMPUTED",
          inspectionStatus: "INCLUDED",
          exclusionStatus: "INCLUDED",
          exclusionReason: null,
        },
      ],
      summary: {
        totalFilesDiscovered: 1,
        totalFilesInspected: 1,
        totalFilesExcluded: 0,
        totalFilesUnreadable: 0,
        totalBytesDiscovered: stat.size,
        totalBytesInspected: stat.size,
      },
      totalFilesScanned: 1,
      totalBytesScanned: stat.size,
      limitExceeded: false,
      scanDurationMs: 5,
    };

    await sm.persistSnapshot({
      repositoryIdentity: cm.getRepository().identity,
      rootPath: ws,
      displayName: "cli-ret-repo",
      inventory,
      extractions: new Map(),
      scannerVersion: "0.6.3",
      extractorVersion: "0.6.3",
    });

    await sm.close();
    return ws;
  }

  it("executes retrieve in json and text modes cleanly and passes retrieval schema", async () => {
    const ws = await seedWorkspace();

    const jsonProc = runCliProc([
      "retrieve",
      "--workspace",
      ws,
      "--agent",
      "implementation-engineer",
      "--task",
      "Update runService in src/service.ts",
      "--file",
      "src/service.ts",
      "--format",
      "json",
    ]);
    expect(jsonProc.status).toBe(0);
    const parsed = JSON.parse(jsonProc.stdout);
    expect(parsed.contract).toBe("frontier-engineer/retrieval");
    expect(parsed.agentId).toBe("implementation-engineer");
    expect(parsed.context.files.some((f: any) => f.filePath === "src/service.ts")).toBe(true);

    const schemaErrors = validateValueAgainstSchema(
      root,
      parsed,
      "cli-retrieve.json",
      "schemas/retrieval-context.schema.json",
      "cli-retrieve-schema",
    );
    expect(schemaErrors).toEqual([]);

    const textProc = runCliProc([
      "retrieve",
      "--workspace",
      ws,
      "--agent",
      "architect",
      "--task",
      "Review architecture of src/service.ts",
    ]);
    expect(textProc.status).toBe(0);
    expect(textProc.stdout).toContain("FRONTIER RETRIEVAL");
    expect(textProc.stdout).toContain("src/service.ts");
  });

  it("enforces CLI argument validation (exit 2), unavailable index without disk mutation (exit 3), and missing scan (exit 4)", async () => {
    const emptyWs = makeTempDir("fe-cli-ret-empty-");
    const badAgent = runCliProc([
      "retrieve",
      "--workspace",
      emptyWs,
      "--agent",
      "unknown-agent",
      "--task",
      "Inspect",
    ]);
    expect(badAgent.status).toBe(2);

    const missingTask = runCliProc(["retrieve", "--workspace", emptyWs, "--agent", "architect"]);
    expect(missingTask.status).toBe(2);

    const unindexed = runCliProc([
      "retrieve",
      "--workspace",
      emptyWs,
      "--agent",
      "architect",
      "--task",
      "Inspect index",
    ]);
    expect(unindexed.status).toBe(3);
    expect(fs.existsSync(path.join(emptyWs, ".frontier"))).toBe(false);

    const ws = await seedWorkspace();
    const missingScan = runCliProc([
      "retrieve",
      "--workspace",
      ws,
      "--scan-id",
      "99999",
      "--task",
      "Inspect missing scan",
    ]);
    expect(missingScan.status).toBe(4);
  });
});
