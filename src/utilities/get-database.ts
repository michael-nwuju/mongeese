import * as fs from "fs-extra";
import path from "path";
import { Db } from "mongodb";

/**
 * Load database connection from bootstrap file
 */
export async function getDatabase(): Promise<Db> {
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

    // Only support getDbWithMongoose
    if (bootstrap.getDbWithMongoose) {
      const db: Db = await bootstrap.getDbWithMongoose();
      return db;
    } else {
      throw new Error(
        "No getDbWithMongoose function found in bootstrap file. Please export getDbWithMongoose."
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
