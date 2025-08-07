// Simulation script for src/core/detection.ts
// Run with: node test-detection.js

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const detection = require("./dist/core/detection.js");

function clearMongooseModels() {
  for (const key of Object.keys(mongoose.models)) {
    delete mongoose.models[key];
  }
}

async function testDetectRegisteredModels() {
  clearMongooseModels();
  const schema = new mongoose.Schema({ name: String });
  mongoose.model("TestModel", schema);
  const models = detection.detectRegisteredModels();
  assert(models.some(m => m.modelName === "TestModel"));
  console.log("✔ detectRegisteredModels simulation passed");
}

async function testDiscoverModelFiles() {
  const files = await detection.discoverModelFiles();
  assert(Array.isArray(files));
  console.log("✔ discoverModelFiles simulation passed");
}

async function testLoadModelFiles() {
  const tempFile = path.join(__dirname, "temp-model.js");
  fs.writeFileSync(
    tempFile,
    'const mongoose = require("mongoose"); mongoose.model("TempModel", new mongoose.Schema({}));'
  );
  const { loaded, errors } = await detection.loadModelFiles([tempFile]);
  assert(loaded.includes(tempFile));
  assert(errors.length === 0);
  fs.unlinkSync(tempFile);
  delete mongoose.models.TempModel;
  console.log("✔ loadModelFiles simulation passed");
}

function testGenerateSnapshotFromModels() {
  clearMongooseModels();
  const schema = new mongoose.Schema({ field: String });
  mongoose.model("SnapModel", schema);
  const snapshot = detection.generateSnapshotFromModels();
  assert(snapshot && typeof snapshot === "object");
  assert(snapshot.collections);
  assert(snapshot.hash);
  console.log("✔ generateSnapshotFromModels simulation passed");
}

function testCompareCodeToDatabase() {
  const snap1 = {
    version: 1,
    hash: "a",
    collections: { foo: { fields: {}, indexes: [] } },
    createdAt: new Date(),
  };
  const snap2 = {
    version: 1,
    hash: "b",
    collections: { bar: { fields: {}, indexes: [] } },
    createdAt: new Date(),
  };
  const result = detection.compareCodeToDatabase(snap1, snap2);
  assert(result.hasChanges);
  assert(result.summary.collections.added.length >= 0);
  console.log("✔ compareCodeToDatabase simulation passed");
}

async function runSimulations() {
  try {
    await testDetectRegisteredModels();
  } catch (e) {
    console.error("✖ detectRegisteredModels simulation failed", e);
  }
  try {
    await testDiscoverModelFiles();
  } catch (e) {
    console.error("✖ discoverModelFiles simulation failed", e);
  }
  try {
    await testLoadModelFiles();
  } catch (e) {
    console.error("✖ loadModelFiles simulation failed", e);
  }
  try {
    testGenerateSnapshotFromModels();
  } catch (e) {
    console.error("✖ generateSnapshotFromModels simulation failed", e);
  }
  try {
    testCompareCodeToDatabase();
  } catch (e) {
    console.error("✖ compareCodeToDatabase simulation failed", e);
  }
}

runSimulations();
