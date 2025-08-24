import * as fs from "fs-extra";
import path from "path";
import { Db, MongoServerSelectionError } from "mongodb";
import { DbWithClient } from "../types";
import { isESModuleProject } from "./is-esm-module-project";

/**
 * Safely check if a module can be resolved
 */
function canResolveModule(moduleName: string): boolean {
  try {
    if (typeof require !== "undefined" && require.resolve) {
      require.resolve(moduleName);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Load a module with compatibility for both CommonJS and ES modules
 */
async function loadModule(filePath: string): Promise<any> {
  const resolvedPath = path.resolve(filePath);
  const isESProject = isESModuleProject(process.cwd());

  // If it's an ES module project, we need to use dynamic import
  if (isESProject && filePath.endsWith(".js")) {
    try {
      // Convert to file URL for proper ES module import
      const fileUrl =
        process.platform === "win32"
          ? `file:///${resolvedPath.replace(/\\/g, "/")}`
          : `file://${resolvedPath}`;

      // Use Function constructor to avoid TypeScript issues with dynamic import
      const importFn = new Function("specifier", "return import(specifier)");
      const module = await importFn(fileUrl);
      return module.default || module;
    } catch (importError) {
      throw new Error(
        `Failed to import ES module ${filePath}: ${
          importError instanceof Error
            ? importError.message
            : String(importError)
        }\n` +
          `This is likely because your project has "type": "module" in package.json.\n` +
          `Solutions:\n` +
          `1. Rename your bootstrap file to mongeese.connection.cjs\n` +
          `2. Or remove "type": "module" from package.json if not needed\n` +
          `3. Or ensure your bootstrap file uses proper ES module syntax (export instead of module.exports)`
      );
    }
  }

  // For CommonJS projects or .cjs files, use require
  try {
    // Clear require cache for fresh load
    if (typeof require !== "undefined" && require.cache) {
      delete require.cache[resolvedPath];
    }

    return require(resolvedPath);
  } catch (requireError) {
    // Check if this is the ES module error
    const errorMessage =
      requireError instanceof Error
        ? requireError.message
        : String(requireError);

    if (errorMessage.includes("require() of ES Module")) {
      throw new Error(
        `Cannot require ES module ${filePath}.\n` +
          `Your project has "type": "module" in package.json, which treats all .js files as ES modules.\n` +
          `Solutions:\n` +
          `1. Rename your bootstrap file to mongeese.connection.cjs\n` +
          `2. Or change your bootstrap file to use ES module syntax:\n` +
          `   Replace: module.exports = { getDbWithClient }\n` +
          `   With: export { getDbWithClient }\n` +
          `3. Or remove "type": "module" from package.json if you want to use CommonJS`
      );
    }

    throw new Error(`Failed to load module ${filePath}: ${errorMessage}`);
  }
}

/**
 * Register TypeScript support with better error handling
 */
function registerTypeScript(): boolean {
  try {
    // Check if we're already in a TypeScript environment
    if (
      process.env.TS_NODE_DEV ||
      (process.env.NODE_OPTIONS && process.env.NODE_OPTIONS.includes("ts-node"))
    ) {
      return true;
    }

    // Try to resolve ts-node
    if (!canResolveModule("ts-node/register")) {
      return false;
    }

    // Try different registration methods
    try {
      // Modern ts-node registration
      require("ts-node/register");
      return true;
    } catch (modernError: any) {
      try {
        // Fallback for older ts-node versions
        const tsNode = require("ts-node");
        if (tsNode.register && typeof tsNode.register === "function") {
          tsNode.register();
          return true;
        }
        return false;
      } catch (legacyError) {
        console.warn(
          "[Mongeese] Failed to register TypeScript:",
          modernError.message
        );
        return false;
      }
    }
  } catch (error) {
    return false;
  }
}

/**
 * Load database connection from bootstrap file
 * Returns DbWithClient if available, otherwise falls back to Db
 */
export async function getDatabase(): Promise<DbWithClient> {
  const JS_BOOTSTRAP_FILE = "mongeese.connection.js";
  const CJS_BOOTSTRAP_FILE = "mongeese.connection.cjs";
  const TS_BOOTSTRAP_FILE = "mongeese.connection.ts";

  let bootstrapFile: string | null = null;
  let needsTypeScript = false;
  const isESProject = isESModuleProject(process.cwd());

  // Check for files in order of preference
  // For ES module projects, prefer .cjs files for better compatibility
  if (isESProject && fs.existsSync(CJS_BOOTSTRAP_FILE)) {
    bootstrapFile = CJS_BOOTSTRAP_FILE;
  }
  // Standard JavaScript file
  else if (fs.existsSync(JS_BOOTSTRAP_FILE)) {
    bootstrapFile = JS_BOOTSTRAP_FILE;
  }
  // TypeScript file
  else if (fs.existsSync(TS_BOOTSTRAP_FILE)) {
    bootstrapFile = TS_BOOTSTRAP_FILE;
    needsTypeScript = true;
  } else {
    const suggestions = isESProject
      ? "mongeese.connection.cjs (recommended for ES module projects) or mongeese.connection.js"
      : "mongeese.connection.js or mongeese.connection.ts";

    throw new Error(
      `No bootstrap file found. Please create a bootstrap file in your project root.\n` +
        `Expected files: ${suggestions}\n` +
        `${
          isESProject
            ? 'Note: Your project uses ES modules ("type": "module"), so .cjs extension is recommended.\n'
            : ""
        }` +
        `Run 'mongeese-cli init' to generate one automatically.`
    );
  }

  // Handle TypeScript registration if needed
  if (needsTypeScript) {
    const tsRegistered = registerTypeScript();
    if (!tsRegistered) {
      throw new Error(
        `Found TypeScript bootstrap file (${TS_BOOTSTRAP_FILE}), but could not register TypeScript support.\n` +
          `Solutions:\n` +
          `1. Install ts-node: npm install ts-node --save-dev\n` +
          `2. Or convert to JavaScript: npx tsc ${TS_BOOTSTRAP_FILE} --outDir .`
      );
    }
  }

  try {
    // Load the bootstrap module using our compatibility function
    const bootstrap = await loadModule(bootstrapFile);

    if (!bootstrap || typeof bootstrap !== "object") {
      throw new Error(
        `Bootstrap file ${bootstrapFile} did not export a valid object`
      );
    }

    // Prefer getDbWithClient for transaction support
    if (
      bootstrap.getDbWithClient &&
      typeof bootstrap.getDbWithClient === "function"
    ) {
      let db: DbWithClient;

      try {
        // Attempt to get the DB, catch errors thrown by new MongoClient(uri)
        db = await bootstrap.getDbWithClient();
      } catch (err: any) {
        if (
          err.message.includes("Invalid scheme") ||
          err.message.includes("startsWith")
        ) {
          throw new Error(
            `Invalid MongoDB URI. Ensure it starts with 'mongodb://' or 'mongodb+srv://'.\n` +
              `Check your MONGODB_URI environment variable or bootstrap configuration.\n` +
              `Original error: ${err.message}`
          );
        }
        throw err; // rethrow other unexpected errors
      }

      if (!db) {
        throw new Error("getDbWithClient() returned null or undefined");
      }

      // Validate that it's a proper database object
      if (typeof db.collection !== "function") {
        throw new Error(
          "getDbWithClient() did not return a valid MongoDB database object"
        );
      }

      // Test connection immediately to detect unreachable server
      if (db.client) {
        try {
          await db.client.db().admin().ping();
        } catch (connErr) {
          if (connErr instanceof MongoServerSelectionError) {
            throw new Error(
              `Failed to connect to MongoDB. The URI might be invalid or the server is unreachable.\n` +
                `Check your MONGODB_URI environment variable or bootstrap configuration.\n` +
                `Original error: ${connErr.message}`
            );
          } else {
            throw connErr;
          }
        }
      }

      return db;
    }

    // Fall back to getDbWithMongoose for backward compatibility
    else if (
      bootstrap.getDbWithMongoose &&
      typeof bootstrap.getDbWithMongoose === "function"
    ) {
      console.warn(
        "[Mongeese] Using legacy getDbWithMongoose. Consider upgrading to getDbWithClient for better transaction support."
      );

      const db: Db = await bootstrap.getDbWithMongoose();

      if (!db) {
        throw new Error("getDbWithMongoose() returned null or undefined");
      }

      if (typeof db.collection !== "function") {
        throw new Error(
          "getDbWithMongoose() did not return a valid MongoDB database object"
        );
      }

      // Cast to DbWithClient (client might be attached by Mongoose)
      const dbWithClient = db as DbWithClient;

      // Warn if no client is attached
      if (!dbWithClient.client) {
        console.warn(
          "[Mongeese] No MongoDB client found on database connection. Some advanced features may not work."
        );
      }

      return dbWithClient;
    } else {
      // Provide helpful debugging info
      const availableExports = Object.keys(bootstrap);
      const exportsList =
        availableExports.length > 0 ? availableExports.join(", ") : "none";

      const exampleCode = isESProject
        ? `// ES Module syntax (for .js files with "type": "module")\n` +
          `import { MongoClient } from "mongodb";\n` +
          `export async function getDbWithClient() {\n` +
          `  const client = new MongoClient(process.env.MONGODB_URI);\n` +
          `  await client.connect();\n` +
          `  const db = client.db();\n` +
          `  db.client = client;\n` +
          `  return db;\n` +
          `}`
        : `// CommonJS syntax (for .js files or .cjs files)\n` +
          `const { MongoClient } = require("mongodb");\n` +
          `async function getDbWithClient() {\n` +
          `  const client = new MongoClient(process.env.MONGODB_URI);\n` +
          `  await client.connect();\n` +
          `  const db = client.db();\n` +
          `  db.client = client;\n` +
          `  return db;\n` +
          `}\n` +
          `module.exports = { getDbWithClient };`;

      throw new Error(
        `Bootstrap file ${bootstrapFile} does not export the required functions.\n` +
          `Expected: getDbWithClient or getDbWithMongoose\n` +
          `Available exports: ${exportsList}\n` +
          `\nExample bootstrap file:\n${exampleCode}`
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Bootstrap file") ||
        error.message.includes("ES module") ||
        error.message.includes("Cannot require"))
    ) {
      // Re-throw our custom errors as-is
      throw error;
    }

    // Enhanced error reporting for unexpected errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    const nodeVersion = process.version;

    throw new Error(
      `Failed to load database connection from ${bootstrapFile}:\n` +
        `Error: ${errorMessage}\n` +
        `Node.js version: ${nodeVersion}\n` +
        `Platform: ${process.platform}\n` +
        `Working directory: ${process.cwd()}\n` +
        `Bootstrap file path: ${path.resolve(bootstrapFile)}\n` +
        `Project type: ${isESProject ? "ES Module" : "CommonJS"}\n` +
        `\nTroubleshooting:\n` +
        `1. Check if the bootstrap file exists and has correct permissions\n` +
        `2. Verify the bootstrap file syntax matches your project type\n` +
        `3. Ensure environment variables (like MONGODB_URI) are set\n` +
        `4. For ES module projects, consider using .cjs extension for better compatibility\n` +
        `5. For TypeScript files, make sure ts-node is installed`
    );
  }
}
