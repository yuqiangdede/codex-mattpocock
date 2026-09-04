/**
 * T-011: SQLite test child — runs inside Electron Utility Process.
 *
 * This script is forked by electron-sqlite-main.js via utilityProcess.fork().
 * It validates node:sqlite DatabaseSync in the Electron Utility Process context.
 */

const { DatabaseSync } = require("node:sqlite");
const { join } = require("node:path");
const { mkdirSync, rmSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");

const testDir = join(tmpdir(), "t011-sqlite-test-" + Date.now());
mkdirSync(testDir, { recursive: true });

const dbPath = join(testDir, "test.db");
const results = [];
let allPassed = true;

function record(name, pass, details) {
  results.push({ name, pass, ...details });
  if (!pass) allPassed = false;
  process.stdout.write(
    JSON.stringify({ test: name, pass, ...details }) + "\n",
  );
}

try {
  // ================================================================
  // 1. Initialize DB with required pragmas
  // ================================================================
  const db = new DatabaseSync(dbPath);

  // Set pragmas
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=FULL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA trusted_schema=OFF");

  // Verify pragmas
  const journalMode = db.prepare("PRAGMA journal_mode").get();
  const synchronous = db.prepare("PRAGMA synchronous").get();
  const foreignKeys = db.prepare("PRAGMA foreign_keys").get();
  const trustedSchema = db.prepare("PRAGMA trusted_schema").get();

  record("journal_mode=WAL", journalMode.journal_mode === "wal", {
    expected: "wal",
    actual: journalMode.journal_mode,
  });

  record("synchronous=FULL", synchronous.synchronous === 2, {
    expected: 2, // FULL = 2
    actual: synchronous.synchronous,
  });

  record("foreign_keys=ON", foreignKeys.foreign_keys === 1, {
    expected: 1,
    actual: foreignKeys.foreign_keys,
  });

  record("trusted_schema=OFF", trustedSchema.trusted_schema === 0, {
    expected: 0,
    actual: trustedSchema.trusted_schema,
  });

  // ================================================================
  // 2. Transaction rollback test
  // ================================================================
  db.exec("CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, name TEXT, balance REAL)");
  db.exec("DELETE FROM accounts");

  // Insert initial data
  db.prepare("INSERT INTO accounts (name, balance) VALUES (?, ?)").run("Alice", 100.0);
  db.prepare("INSERT INTO accounts (name, balance) VALUES (?, ?)").run("Bob", 50.0);

  // Attempt a transaction that fails midway
  let rollbackWorked = false;
  try {
    db.exec("BEGIN TRANSACTION");
    db.prepare("UPDATE accounts SET balance = balance - 30 WHERE name = ?").run("Alice");
    // Force an error: insert into non-existent table
    db.exec("INSERT INTO nonexistent_table VALUES (1)");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    // Verify Alice's balance is still 100 (rollback worked)
    const alice = db.prepare("SELECT balance FROM accounts WHERE name = ?").get("Alice");
    rollbackWorked = alice.balance === 100.0;
  }

  record("transaction_rollback", rollbackWorked, {
    aliceBalanceAfterRollback: db.prepare("SELECT balance FROM accounts WHERE name = ?").get("Alice").balance,
  });

  // ================================================================
  // 3. Foreign key constraint test (ON DELETE CASCADE)
  // ================================================================
  db.exec("CREATE TABLE IF NOT EXISTS parents (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS children (id INTEGER PRIMARY KEY, parent_id INTEGER, name TEXT, FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE)");
  db.exec("DELETE FROM children");
  db.exec("DELETE FROM parents");

  db.prepare("INSERT INTO parents (name) VALUES (?)").run("Parent1");
  const parent1 = db.prepare("SELECT id FROM parents WHERE name = ?").get("Parent1");
  db.prepare("INSERT INTO children (parent_id, name) VALUES (?, ?)").run(parent1.id, "Child1");
  db.prepare("INSERT INTO children (parent_id, name) VALUES (?, ?)").run(parent1.id, "Child2");

  // Delete parent → children should cascade delete
  db.prepare("DELETE FROM parents WHERE name = ?").run("Parent1");
  const remainingChildren = db.prepare("SELECT COUNT(*) as count FROM children").get();

  record("foreign_key_cascade_delete", remainingChildren.count === 0, {
    childrenRemaining: remainingChildren.count,
    expected: 0,
  });

  // ================================================================
  // 4. Concurrent read test (multiple read connections don't block write)
  // ================================================================
  db.exec("CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, value INTEGER)");
  db.exec("DELETE FROM counter");
  db.prepare("INSERT INTO counter (value) VALUES (?)").run(0);

  // Open two read-only connections
  const reader1 = new DatabaseSync(dbPath, { readOnly: true });
  const reader2 = new DatabaseSync(dbPath, { readOnly: true });

  // Read from both readers
  const r1 = reader1.prepare("SELECT value FROM counter WHERE id = 1").get();
  const r2 = reader2.prepare("SELECT value FROM counter WHERE id = 1").get();

  // Write via main connection while readers are open
  db.prepare("UPDATE counter SET value = ? WHERE id = 1").run(42);
  const afterWrite = db.prepare("SELECT value FROM counter WHERE id = 1").get();

  record("concurrent_read_no_block", r1.value === 0 && r2.value === 0 && afterWrite.value === 42, {
    reader1Value: r1.value,
    reader2Value: r2.value,
    writerValueAfter: afterWrite.value,
  });

  reader1.close();
  reader2.close();

  // ================================================================
  // 5. Busy Timeout test
  // ================================================================
  // Set busy timeout
  db.exec("PRAGMA busy_timeout = 5000");
  const busyTimeout = db.prepare("PRAGMA busy_timeout").get();
  const busyTimeoutValue = busyTimeout.timeout !== undefined ? busyTimeout.timeout : busyTimeout.busy_timeout;
  record("busy_timeout", busyTimeoutValue === 5000, {
    expected: 5000,
    actual: busyTimeoutValue,
    rawPragma: busyTimeout,
  });

  // ================================================================
  // Cleanup
  // ================================================================
  db.close();
  rmSync(testDir, { recursive: true, force: true });

  // Send final result
  process.stdout.write(
    JSON.stringify({
      done: true,
      allPassed,
      testCount: results.length,
      passedCount: results.filter((r) => r.pass).length,
      failedCount: results.filter((r) => !r.pass).length,
    }) + "\n",
  );
} catch (err) {
  process.stderr.write(
    JSON.stringify({
      done: true,
      allPassed: false,
      fatalError: err.message,
      stack: err.stack,
    }) + "\n",
  );
}
