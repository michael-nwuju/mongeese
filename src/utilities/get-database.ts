import * as fs from "fs-extra";
import path from "path";
import { Db } from "mongodb";
import { DbWithClient } from "../types";

/**
 * Load database connection from bootstrap file
 * Returns DbWithClient if available, otherwise falls back to Db
 */
export async function getDatabase(): Promise<DbWithClient> {
  const JS_BOOTSTRAP_FILE = "mongeese.connection.js";
  const TS_BOOTSTRAP_FILE = "mongeese.connection.ts";

  let bootstrapFile: string | null = null;

  if (fs.existsSync(JS_BOOTSTRAP_FILE)) {
    bootstrapFile = JS_BOOTSTRAP_FILE;
  } else if (fs.existsSync(TS_BOOTSTRAP_FILE)) {
    // Register ts-node if running from CLI and .ts file is found
    try {
      require.resolve("ts-node/register");
      require("ts-node/register");
    } catch (err) {
      throw new Error(
        `Found TypeScript bootstrap file (mongeese.connection.ts), but ts-node is not installed.\n` +
          `Please install ts-node in your project: npm install ts-node --save-dev\n` +
          `Or transpile your bootstrap file to JavaScript.\n` +
          `Run: npx tsc mongeese.connection.ts --outDir .`
      );
    }
    bootstrapFile = TS_BOOTSTRAP_FILE;
  } else {
    throw new Error(
      `No bootstrap file found. Please run 'mongeese-cli init' to create a mongeese.connection.ts or mongeese.connection.js file in your project root.`
    );
  }

  try {
    // Import the bootstrap file
    const bootstrap = require(path.resolve(bootstrapFile));

    // Prefer getDbWithClient for transaction support
    if (bootstrap.getDbWithClient) {
      const db: DbWithClient = await bootstrap.getDbWithClient();
      return db;
    }
    // Fall back to getDbWithMongoose for backward compatibility
    else if (bootstrap.getDbWithMongoose) {
      console.warn(
        "[Mongeese] Using legacy getDbWithMongoose. Consider upgrading to getDbWithClient for transaction support."
      );
      const db: Db = await bootstrap.getDbWithMongoose();
      // Try to add client if available from mongoose connection
      return db as DbWithClient;
    } else {
      throw new Error(
        "No getDbWithClient or getDbWithMongoose function found in bootstrap file. Please export getDbWithClient for transaction support."
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to load database connection from ${bootstrapFile}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
