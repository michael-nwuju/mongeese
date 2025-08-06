import * as fs from "fs-extra";
import path from "path";
import detectProjectType from "./detect-project-type";
import { Db } from "mongodb";

/**
 * Load database connection from bootstrap file
 */
export async function getDatabase(): Promise<Db> {
  const PROJECT_TYPE = detectProjectType();
  const EXTENSION = PROJECT_TYPE === "typescript" ? "ts" : "js";
  const BOOTSTRAP_FILE = `mongeese.connection.${EXTENSION}`;

  if (!fs.existsSync(BOOTSTRAP_FILE)) {
    throw new Error(
      `Bootstrap file not found: ${BOOTSTRAP_FILE}. Run 'mongeese init' first.`
    );
  }

  try {
    // Import the bootstrap file
    const bootstrap = require(path.resolve(BOOTSTRAP_FILE));

    // Try to get database connection
    let db: Db;

    if (bootstrap.getDbWithMongoose) {
      db = await bootstrap.getDbWithMongoose();
    } else if (bootstrap.getDbWithNative) {
      db = await bootstrap.getDbWithNative();
    } else {
      throw new Error(
        "No database connection function found in bootstrap file"
      );
    }

    return db;
  } catch (error) {
    throw new Error(
      `Failed to load database connection: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
