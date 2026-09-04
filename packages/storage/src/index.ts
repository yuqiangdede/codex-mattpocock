/**
 * @workbench/storage
 *
 * SQLite storage layer using node:sqlite DatabaseSync.
 * Agent Manager owns the sole write connection.
 * Will be validated in Packaged Utility Process in T-011.
 */

/** SQLite PRAGMA initialization values */
export const SQLITE_PRAGMAS = {
  journal_mode: "WAL",
  synchronous: "FULL",
  foreign_keys: "ON",
  trusted_schema: "OFF",
} as const;
