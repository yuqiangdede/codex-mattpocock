/**
 * T-010: Provider Probe Invalidation Validation.
 *
 * Verifies that when the Provider config (base_url, model_id, or credentials)
 * changes, the existing Probe Report is marked as invalidated and cannot be
 * used without re-running the probe.
 *
 * This is a logic-only test — it does NOT connect to any provider. It validates
 * the invalidation detection mechanism that would be used at runtime to decide
 * whether a cached Probe Report is still valid for the current config.
 *
 * Usage: node scripts/spike/probe-invalidation.mjs
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const reportDir = join(projectRoot, "release-evidence");
const reportFile = join(reportDir, "provider-probe-report.json");

mkdirSync(reportDir, { recursive: true });

const testStartTime = new Date().toISOString();

// ================================================================
// Config fingerprint: hash of base_url + model_id + credential_tag
// ================================================================

/**
 * Compute a config fingerprint from provider settings.
 * The credential is never stored in the report — only a hash of it
 * is used to detect changes (like git blob hashes).
 */
function computeConfigFingerprint(base_url, model_id, api_key) {
  // Credential tag: SHA-256 of the API key, truncated to 16 hex chars
  // This lets us detect credential changes without storing the key
  const credential_tag = api_key
    ? createHash("sha256").update(api_key).digest("hex").slice(0, 16)
    : "no-credential";

  const fingerprint = createHash("sha256")
    .update(`${base_url}|${model_id}|${credential_tag}`)
    .digest("hex");

  return {
    fingerprint,
    credential_tag,
  };
}

/**
 * Check if a stored report is valid for the current config.
 * Returns { valid: boolean, reason: string, changedField: string|null }
 */
function checkReportValidity(storedReport, currentConfig) {
  if (!storedReport || !storedReport.provider) {
    return { valid: false, reason: "No stored report found", changedField: null };
  }

  const stored = storedReport.provider;
  const changes = [];

  if (stored.base_url !== currentConfig.base_url) {
    changes.push({
      field: "base_url",
      oldValue: stored.base_url,
      newValue: currentConfig.base_url,
    });
  }

  if (stored.model_id !== currentConfig.model_id) {
    changes.push({
      field: "model_id",
      oldValue: stored.model_id,
      newValue: currentConfig.model_id,
    });
  }

  // Check credential tag if stored
  if (
    storedReport.config_fingerprint &&
    storedReport.config_fingerprint.credential_tag
  ) {
    const currentFp = computeConfigFingerprint(
      currentConfig.base_url,
      currentConfig.model_id,
      currentConfig.api_key,
    );
    if (
      storedReport.config_fingerprint.credential_tag !==
      currentFp.credential_tag
    ) {
      changes.push({
        field: "credential",
        oldValue: storedReport.config_fingerprint.credential_tag,
        newValue: currentFp.credential_tag,
      });
    }
  }

  if (changes.length === 0) {
    return { valid: true, reason: null, changedField: null, changes: [] };
  }

  return {
    valid: false,
    reason: `Config changed: ${changes.map((c) => c.field).join(", ")}`,
    changedField: changes.map((c) => c.field).join(", "),
    changes,
  };
}

// ================================================================
// Test cases
// ================================================================

// The original config from T-009
const ORIGINAL_BASE_URL = "https://api.qnaigc.com/v1";
const ORIGINAL_MODEL_ID = "deepseek/deepseek-v4-flash-vision-exp";
const ORIGINAL_API_KEY = "sk-test-original-key-12345"; // sentinel, not real

// Compute fingerprint for original config
const originalFp = computeConfigFingerprint(
  ORIGINAL_BASE_URL,
  ORIGINAL_MODEL_ID,
  ORIGINAL_API_KEY,
);

// Load the existing report (from T-009) and augment it with config_fingerprint
let existingReport = null;
try {
  const raw = readFileSync(reportFile, "utf8");
  existingReport = JSON.parse(raw);
} catch {
  // Report doesn't exist yet — create a minimal stub for testing
  existingReport = {
    provider: {
      base_url: ORIGINAL_BASE_URL,
      model_id: ORIGINAL_MODEL_ID,
    },
    overall: { pass: true },
  };
}

// Augment stored report with config fingerprint (simulating what the probe
// script would store when it runs)
const storedReport = {
  ...existingReport,
  provider: {
    ...existingReport.provider,
  },
  config_fingerprint: {
    fingerprint: originalFp.fingerprint,
    credential_tag: originalFp.credential_tag,
  },
};

const testCases = [
  {
    name: "No change — should be VALID",
    config: {
      base_url: ORIGINAL_BASE_URL,
      model_id: ORIGINAL_MODEL_ID,
      api_key: ORIGINAL_API_KEY,
    },
    expectValid: true,
  },
  {
    name: "Changed base_url — should be INVALID",
    config: {
      base_url: "https://api.different-provider.com/v1",
      model_id: ORIGINAL_MODEL_ID,
      api_key: ORIGINAL_API_KEY,
    },
    expectValid: false,
    expectedChangedField: "base_url",
  },
  {
    name: "Changed model_id — should be INVALID",
    config: {
      base_url: ORIGINAL_BASE_URL,
      model_id: "openai/gpt-4o-mini",
      api_key: ORIGINAL_API_KEY,
    },
    expectValid: false,
    expectedChangedField: "model_id",
  },
  {
    name: "Changed credential — should be INVALID",
    config: {
      base_url: ORIGINAL_BASE_URL,
      model_id: ORIGINAL_MODEL_ID,
      api_key: "sk-test-different-key-67890",
    },
    expectValid: false,
    expectedChangedField: "credential",
  },
  {
    name: "All three changed — should be INVALID",
    config: {
      base_url: "https://api.new-provider.com/v2",
      model_id: "anthropic/claude-3.5-sonnet",
      api_key: "sk-yet-another-key-00000",
    },
    expectValid: false,
    expectedChangedField: "base_url, model_id, credential",
  },
];

// ================================================================
// Run tests
// ================================================================

console.log("[invalidation] Starting probe invalidation tests...\n");

const testResults = [];
let allPassed = true;

for (const tc of testCases) {
  const result = checkReportValidity(storedReport, tc.config);
  const passed = result.valid === tc.expectValid;

  // For invalid cases, also check the changed field matches
  let fieldMatch = true;
  if (!tc.expectValid && tc.expectedChangedField) {
    fieldMatch = result.changedField === tc.expectedChangedField;
  }

  const testPass = passed && fieldMatch;
  if (!testPass) allPassed = false;

  console.log(
    `[invalidation] ${tc.name}: ${testPass ? "PASS" : "FAIL"}` +
      (testPass ? "" : ` (expected valid=${tc.expectValid}, got valid=${result.valid})`),
  );
  if (!result.valid && result.reason) {
    console.log(`  → Reason: ${result.reason}`);
  }

  testResults.push({
    name: tc.name,
    config: {
      base_url: tc.config.base_url,
      model_id: tc.config.model_id,
      // credential_tag only, not the actual key
      credential_tag: computeConfigFingerprint(
        tc.config.base_url,
        tc.config.model_id,
        tc.config.api_key,
      ).credential_tag,
    },
    expectedValid: tc.expectValid,
    actualValid: result.valid,
    passed: testPass,
    reason: result.reason,
    changedField: result.changedField,
    changes: result.changes || [],
  });
}

const testEndTime = new Date().toISOString();

// ================================================================
// Update report with invalidation test record
// ================================================================

const updatedReport = {
  ...storedReport,
  invalidationTests: {
    testedAt: testStartTime,
    completedAt: testEndTime,
    testCount: testResults.length,
    allPassed,
    results: testResults,
  },
};

writeFileSync(reportFile, JSON.stringify(updatedReport, null, 2) + "\n", "utf8");

console.log(`\n[invalidation] All tests passed: ${allPassed}`);
console.log(`[invalidation] Report updated: ${reportFile}`);

if (!allPassed) {
  console.log("[invalidation] FAIL — some invalidation tests did not pass");
}

process.exitCode = allPassed ? 0 : 1;
