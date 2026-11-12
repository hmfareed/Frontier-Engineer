/**
 * Phase 7.3 — SQLite Database Wrapper
 * Encapsulates node:sqlite DatabaseSync with strict pragmas, foreign-key enforcement, and transaction safety.
 */

import { DatabaseSync } from "node:sqlite";

export interface DatabaseOptions {
  path?: string; // ":memory:" or filesystem path. Defaults to ":memory:"
  readOnly?: boolean;
  enableWal?: boolean; // Defaults to true for file databases
  busyTimeoutMs?: number; // Defaults to 5000ms
}

export class SqliteDatabase {
  private db: DatabaseSync;
  private closed = false;
  private readonly dbPath: string;

  constructor(options: DatabaseOptions = {}) {
    this.dbPath = options.path ?? ":memory:";
    const readOnly = options.readOnly ?? false;

    this.db = new DatabaseSync(this.dbPath, {
      readOnly,
    });

    this.configurePragmas(options);
  }

  private configurePragmas(options: DatabaseOptions): void {
    // 1. Mandatory foreign-key enforcement
    this.db.exec("PRAGMA foreign_keys = ON;");

    // 2. Busy timeout to prevent immediate lock failures on concurrent access
    const timeout = options.busyTimeoutMs ?? 5000;
    this.db.exec(`PRAGMA busy_timeout = ${timeout};`);

    // 3. WAL mode and NORMAL synchronous for file-backed databases
    if (this.dbPath !== ":memory:") {
      const enableWal = options.enableWal ?? true;
      if (enableWal) {
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA synchronous = NORMAL;");
      }
    }
  }

  public get rawDb(): DatabaseSync {
    this.ensureOpen();
    return this.db;
  }

  public get path(): string {
    return this.dbPath;
  }

  public isOpen(): boolean {
    return !this.closed;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error(`Database at ${this.dbPath} is closed.`);
    }
  }

  public exec(sql: string): void {
    this.ensureOpen();
    this.db.exec(sql);
  }

  public prepare(sql: string) {
    this.ensureOpen();
    return this.db.prepare(sql);
  }

  /**
   * Executes a synchronous block inside an immediate transaction.
   * Automatically rolls back on exception.
   */
  public transaction<T>(fn: () => T): T {
    this.ensureOpen();
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // Suppress rollback errors if transaction was already aborted
      }
      throw err;
    }
  }

  public close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }

  public integrityCheck(): { ok: boolean; message: string } {
    this.ensureOpen();
    const row = this.db.prepare("PRAGMA integrity_check;").get() as
      { integrity_check?: string } | undefined;
    const status = row?.integrity_check ?? "unknown";
    return { ok: status === "ok", message: status };
  }
}
