// Simulation script for src/core/generate.ts
// Run with: node test-generate.js

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const generate = require("./dist/core/generate.js");

function testGenerateTimestamp() {
  const ts = generate.generateTimestamp();
  assert(/\d{8}_\d{6}/.test(ts));
  console.log("✔ generateTimestamp simulation passed");
}

function testSanitizeMigrationName() {
  const name = "My Migration!@# 2024";
  const sanitized = generate.sanitizeMigrationName(name);
  assert(!/[^a-z0-9_]/.test(sanitized));
  console.log("✔ sanitizeMigrationName simulation passed");
}

function testGenerateMigrationContent() {
  const migrationName = "TestMigration";
  const diffResult = {
    up: [{ command: 'db.createCollection("foo")', description: "Create foo" }],
    down: [{ command: 'db.dropCollection("foo")', description: "Drop foo" }],
    warnings: [],
    metadata: {
      collections: { added: [], removed: [], modified: [] },
      fields: { added: [], removed: [], renamed: [] },
      indexes: { added: [], removed: [] },
    },
  };
  const content = generate.generateMigrationContent(migrationName, diffResult);
  assert(typeof content === "string");
  assert(content.includes(migrationName));
  console.log("✔ generateMigrationContent simulation passed");
}

async function testEnsureMigrationsDirectory() {
  const dir = await generate.ensureMigrationsDirectory();
  assert(fs.existsSync(dir));
  // Clean up
  fs.rmdirSync(dir, { recursive: true });
  console.log("✔ ensureMigrationsDirectory simulation passed");
}

async function testGenerateMigrationPreview() {
  const diffResult = {
    up: [{ command: 'db.createCollection("foo")', description: "Create foo" }],
    down: [{ command: 'db.dropCollection("foo")', description: "Drop foo" }],
    warnings: [],
    metadata: {
      collections: { added: [], removed: [], modified: [] },
      fields: { added: [], removed: [], renamed: [] },
      indexes: { added: [], removed: [] },
    },
  };
  await generate.generateMigrationPreview(diffResult, {
    name: "test_migration",
  });
  const migrationsDir = path.join(process.cwd(), "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.includes("test_migration"));
  assert(files.length > 0);
  // Clean up
  files.forEach(f => fs.unlinkSync(path.join(migrationsDir, f)));
  fs.rmdirSync(migrationsDir);
  console.log("✔ generateMigrationPreview simulation passed");
}

async function runSimulations() {
  try {
    testGenerateTimestamp();
  } catch (e) {
    console.error("✖ generateTimestamp simulation failed", e);
  }
  try {
    testSanitizeMigrationName();
  } catch (e) {
    console.error("✖ sanitizeMigrationName simulation failed", e);
  }
  try {
    testGenerateMigrationContent();
  } catch (e) {
    console.error("✖ generateMigrationContent simulation failed", e);
  }
  try {
    await testEnsureMigrationsDirectory();
  } catch (e) {
    console.error("✖ ensureMigrationsDirectory simulation failed", e);
  }
  try {
    await testGenerateMigrationPreview();
  } catch (e) {
    console.error("✖ generateMigrationPreview simulation failed", e);
  }
}

runSimulations();
