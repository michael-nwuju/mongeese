import chalk from "chalk";
import fs from "fs-extra";
import detectProjectType from "../utilities/detect-project-type";

const PROJECT_TYPE = detectProjectType();

const EXTENSION = PROJECT_TYPE === "typescript" ? "ts" : "js";

const BOOTSTRAP_FILE = `mongeese.connection.${EXTENSION}`;

const BOOTSTRAP_TEMPLATE_TS = `// mongeese.connection.ts

import mongoose from "mongoose";
import { MongoClient, Db } from "mongodb";

// DbWithClient type that extends Db with an attached client property
export interface DbWithClient extends Db {
  client: MongoClient;
}

/**
 * Factory function that returns a DbWithClient object with the client attached.
 * This allows Mongeese to use transactions for migration operations.
 */
export async function getDbWithClient(uri?: string, dbName?: string): Promise<DbWithClient> {
  const mongoUri = uri || process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb";
  const client = new MongoClient(mongoUri);
  
  await client.connect();
  const db = client.db(dbName);
  
  // Attach the client to the db instance
  (db as DbWithClient).client = client;
  
  return db as DbWithClient;
}

// Legacy function for backward compatibility - use getDbWithClient instead
export async function getDbWithMongoose(): Promise<Db> {
  console.warn("[Mongeese] getDbWithMongoose is deprecated. Please use getDbWithClient for transaction support.");
  const mongooseConnection = await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb");
  
  if (!mongooseConnection) {
    throw new Error("Failed to connect to MongoDB");
  }
  
  return mongooseConnection.connection.db;
}
`;

const BOOTSTRAP_TEMPLATE_JS = `// mongeese.connection.js

const mongoose = require("mongoose");
const { MongoClient } = require("mongodb");

/**
 * Factory function that returns a DbWithClient object with the client attached.
 * This allows Mongeese to use transactions for migration operations.
 */
async function getDbWithClient(uri, dbName) {
  const mongoUri = uri || process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb";
  const client = new MongoClient(mongoUri);
  
  await client.connect();
  const db = client.db(dbName);
  
  // Attach the client to the db instance
  db.client = client;
  
  return db;
}

// Legacy function for backward compatibility - use getDbWithClient instead
async function getDbWithMongoose() {
  console.warn("[Mongeese] getDbWithMongoose is deprecated. Please use getDbWithClient for transaction support.");
  const mongooseConnection = await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb");
  
  if (!mongooseConnection) {
    throw new Error("Failed to connect to MongoDB");
  }
  
  return mongooseConnection.connection.db;
}

module.exports = { getDbWithClient, getDbWithMongoose };
`;

const BOOTSTRAP_TEMPLATE =
  PROJECT_TYPE === "typescript" ? BOOTSTRAP_TEMPLATE_TS : BOOTSTRAP_TEMPLATE_JS;

export default async function init(): Promise<void> {
  try {
    if (fs.existsSync(BOOTSTRAP_FILE)) {
      return console.log(chalk.yellow(`${BOOTSTRAP_FILE} already exists.`));
    }

    // Create bootstrap file
    fs.writeFileSync(BOOTSTRAP_FILE, BOOTSTRAP_TEMPLATE);

    console.log(chalk.cyan("\n✅ Bootstrap file created!"));

    console.log(chalk.cyan("\nNext steps:"));

    console.log(
      chalk.cyan("1. Edit the connection file to set your MONGODB_URI")
    );

    console.log(
      chalk.cyan("2. Run 'mongeese generate' to create your first snapshot")
    );
    process.exit(0);
  } catch (error) {
    console.error(chalk.red("❌ Error during initialization:"), error);
    process.exit(1);
  }
}
