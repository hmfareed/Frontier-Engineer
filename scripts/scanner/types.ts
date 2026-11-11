/**
 * Phase 7.1 — Repository Scanner & File Inventory Data Types
 * Storage-independent DTOs and contracts.
 */

export type FileClassification =
  "source" | "documentation" | "configuration" | "asset" | "binary" | "sensitive" | "unknown";

export type HashState =
  | "COMPUTED"
  | "SKIPPED_SENSITIVE"
  | "SKIPPED_BINARY"
  | "SKIPPED_LIMIT"
  | "SKIPPED_UNREADABLE"
  | "ERROR";

export type FileInspectionStatus =
  | "INSPECTED"
  | "INCLUDED"
  | "EXCLUDED_PATH"
  | "EXCLUDED_CONTENT"
  | "EXCLUDED_IGNORE"
  | "EXCLUDED_LIMIT"
  | "EXTERNAL_SYMLINK_EXCLUDED"
  | "UNREADABLE"
  | "UNSTABLE"
  | "UNSUPPORTED";

/** Backward-compatible alias for FileInspectionStatus */
export type ExclusionStatus = FileInspectionStatus;

export type ScanStatus =
  "COMPLETE" | "LIMIT_REACHED" | "CANCELLED" | "PARTIAL_WITH_ERRORS" | "FATAL_ERROR";

export interface ScannedFileRecord {
  canonicalPath: string;
  fileExtension: string;
  classification: FileClassification;
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string | null;
  hashState: HashState;
  inspectionStatus: FileInspectionStatus;
  /** Backward-compatible alias for inspectionStatus */
  exclusionStatus: ExclusionStatus;
  exclusionReason: string | null;
  extractedConfigKeys?: string[];
  symlinkTarget?: string;
}

export interface ScanLimits {
  maxFiles?: number; // default: 50,000
  maxTotalBytes?: number; // default: 500 MB (500 * 1024 * 1024)
  maxFileSizeBytes?: number; // default: 10 MB (10 * 1024 * 1024)
}

export interface ScanOptions {
  limits?: ScanLimits;
  signal?: AbortSignal;
  onProgress?: (scannedCount: number, currentPath: string) => void;
}

export interface InventorySummary {
  totalFilesDiscovered: number;
  totalFilesInspected: number;
  totalFilesExcluded: number;
  totalFilesUnreadable: number;
  totalBytesDiscovered: number;
  totalBytesInspected: number;
}

export interface FileInventoryResult {
  workspaceRoot: string;
  scannedAt: string;
  scanStatus: ScanStatus;
  statusReason?: string;
  files: ScannedFileRecord[];
  summary: InventorySummary;
  /** Backward-compatible count property */
  totalFilesScanned: number;
  /** Backward-compatible count property */
  totalBytesScanned: number;
  limitExceeded: boolean;
  limitReason?: string;
  scanDurationMs: number;
}

/**
 * Storage-independent repository persistence contract (Future-Facing Port).
 * This interface defines the contract that Phase 7.3 persistence adapters
 * (e.g. SQLite driver) must implement. It is NOT a runtime dependency in Phase 7.1.
 * Phase 7.1 scanner operates purely in memory with zero database dependencies.
 */
export interface IFileRepository {
  saveInventory(revisionId: string, inventory: FileInventoryResult): Promise<void>;
  listInventory(revisionId: string): Promise<ScannedFileRecord[]>;
  findByPath(revisionId: string, canonicalPath: string): Promise<ScannedFileRecord | null>;
}
