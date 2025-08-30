import chalk from "chalk";
import fs from "fs-extra";
import detectProjectType from "../utilities/detect-project-type";
import { safeResolve, secureWriteFile } from "../utilities/security-utils";

const PROJECT_TYPE = detectProjectType();

const EXTENSION = PROJECT_TYPE === "typescript" ? "ts" : "js";

const BOOTSTRAP_FILE = `mongeese.connection.${EXTENSION}`;

const BOOTSTRAP_TEMPLATE_TS = `// mongeese.connection.ts
import { MongoClient, Db } from "mongodb";
import * as dotenv from "dotenv";

dotenv?.config();

// DbWithClient type that extends Db with an attached client property
export interface DbWithClient extends Db {
  client: MongoClient;
}

/**
 * Factory function that returns a DbWithClient object with the client attached.
 * This allows Mongeese to use transactions for migration operations.
 */
export async function getDbWithClient(dbName?: string): Promise<DbWithClient> {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  await client.connect();

  const db = client.db(dbName);
  
  // Attach the client to the db instance
  (db as DbWithClient).client = client;
  
  return db as DbWithClient;
}
`;

const BOOTSTRAP_TEMPLATE_JS = `// mongeese.connection.js
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv?.config();

/**
 * Factory function that returns a DbWithClient object with the client attached.
 * This allows Mongeese to use transactions for migration operations.
 */
export async function getDbWithClient(dbName) {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  await client.connect();

  const db = client.db(dbName);
  
  // Attach the client to the db instance
  db.client = client;
  
  return db;
}
`;

const BOOTSTRAP_TEMPLATE =
  PROJECT_TYPE === "typescript" ? BOOTSTRAP_TEMPLATE_TS : BOOTSTRAP_TEMPLATE_JS;

export default async function init(): Promise<void> {
  try {
    // Safely resolve the bootstrap file path
    const safePath = safeResolve(process.cwd(), BOOTSTRAP_FILE);

    if (await fs.pathExists(safePath)) {
      return console.log(chalk.yellow(`${BOOTSTRAP_FILE} already exists.`));
    }

    // Create bootstrap file with secure permissions
    await secureWriteFile(safePath, BOOTSTRAP_TEMPLATE);

    console.log(chalk.cyan("\n✅ Bootstrap file created!"));

    console.log(chalk.cyan("\nNext steps:"));

    console.log(
      chalk.cyan("1. Edit the connection file to set your MONGODB_URI")
    );

    console.log(
      chalk.cyan("2. Run 'mongeese generate' to create your first migration")
    );
    process.exit(0);
  } catch (error) {
    console.error(chalk.red("❌ Error during initialization:"), error);
    process.exit(1);
  }
}
