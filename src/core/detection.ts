import { Schema, SchemaType, Model, ConnectionStates } from "mongoose";
import * as path from "path";
import { glob } from "glob";
import {
  Snapshot,
  CollectionStructure,
  FieldDefinition,
  IndexDefinition,
  ModelDetectionConfig,
  MongooseFieldInfo,
} from "../types";
import { isESModuleProject } from "../utilities/is-esm-module-project";
import { generateSnapshotHash } from "./snapshot";
import { generateNestJSSnapshot } from "./nestjs-detection";
import { createRequire } from "module";
import type * as Mongoose from "mongoose";

const projectRoot = process.cwd();
const projectRequire = createRequire(path.join(projectRoot, "package.json"));

// Use the project's mongoose
const mongoose: typeof Mongoose = projectRequire("mongoose");

/**
 * Detects if the current project is a NestJS project
 * Checks multiple indicators to be thorough
 */
function isNestJSProject(): boolean {
  try {
    // Method 1: Check package.json for NestJS dependencies
    const packageJsonPath = path.join(process.cwd(), "package.json");
    const packageJson = require(packageJsonPath);
    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const hasNestCore = !!allDependencies["@nestjs/core"];
    const hasNestMongoose = !!allDependencies["@nestjs/mongoose"];

    if (hasNestCore && hasNestMongoose) {
      return true;
    }

    const nestjsFiles = [
      "src/app.module.ts",
      "src/main.ts",
      "apps/*/src/app.module.ts",
    ];

    for (const filePath of nestjsFiles) {
      try {
        const fullPath = path.join(process.cwd(), filePath);
        if (require("fs").existsSync(fullPath)) {
          // Check file content for NestJS imports
          const content = require("fs").readFileSync(fullPath, "utf8");
          if (content.includes("@nestjs/") || content.includes("NestFactory")) {
            return true;
          }
        }
      } catch (error) {
        // Ignore file read errors, continue checking
      }
    }

    // Method 3: Check for nest-cli.json
    try {
      const nestCliPath = path.join(process.cwd(), "nest-cli.json");
      if (require("fs").existsSync(nestCliPath)) {
        return true;
      }
    } catch (error) {
      // Ignore
    }

    return false;
  } catch (error: any) {
    if (error.message) {
      console.warn("[Mongeese] Could not detect project type:", error.message);
    }
    return false;
  }
}

/**
 * Enhanced model detection that tries multiple approaches
 */
export function detectRegisteredModelsAdvanced(): {
  models: Model<any>[];
  detectionMethod: string;
  diagnostics: any;
} {
  const diagnostics = {
    mongooseInitialized: false,
    defaultConnectionState: "unknown",
    defaultModelCount: 0,
    defaultModelNames: [] as string[],
    totalConnections: 0,
    connectionStates: [] as any[],
    allModelNames: [] as string[],
  };

  let models: Model<any>[] = [];
  let detectionMethod = "none";

  try {
    // Check Mongoose initialization
    diagnostics.mongooseInitialized = !!(mongoose && mongoose.models);

    // Method 1: Try default mongoose.models (most common)
    if (
      mongoose &&
      mongoose.models &&
      Object.keys(mongoose.models).length > 0
    ) {
      const defaultModels = Object.values(mongoose.models) as Model<any>[];
      models.push(...defaultModels);

      diagnostics.defaultModelCount = defaultModels.length;
      diagnostics.defaultModelNames = defaultModels.map(m => m.modelName);

      detectionMethod = "default-mongoose-models";
    }

    // Method 2: Check all connections for models
    if (mongoose.connections && mongoose.connections.length > 0) {
      diagnostics.totalConnections = mongoose.connections.length;

      mongoose.connections.forEach((connection, index) => {
        const connInfo = {
          index,
          name: connection.name || "default",
          readyState: connection.readyState,
          modelCount: 0,
          modelNames: [] as string[],
        };

        if (connection.models && Object.keys(connection.models).length > 0) {
          const connectionModels = Object.values(
            connection.models
          ) as Model<any>[];
          connInfo.modelCount = connectionModels.length;
          connInfo.modelNames = connectionModels.map(m => m.modelName);

          // Add models that aren't already in our list
          connectionModels.forEach(model => {
            if (
              !models.some(
                existingModel => existingModel.modelName === model.modelName
              )
            ) {
              models.push(model);
            }
          });

          if (detectionMethod === "none") {
            detectionMethod = `connection-${index}`;
          } else if (!detectionMethod.includes("multiple-connections")) {
            detectionMethod = "multiple-connections";
          }
        }

        diagnostics.connectionStates.push(connInfo);
      });
    }

    // Method 3: Try mongoose.connection.models (alternative access)
    if (
      models.length === 0 &&
      mongoose.connection &&
      mongoose.connection.models
    ) {
      try {
        const connectionModels = Object.values(
          mongoose.connection.models
        ) as Model<any>[];
        if (connectionModels.length > 0) {
          models.push(...connectionModels);
          detectionMethod = "mongoose-connection-models";
        }
      } catch (error) {
        console.warn(
          "[Mongeese] Could not access mongoose.connection.models:",
          error
        );
      }
    }

    // Method 4: Try to access models through mongoose.modelNames() (if available)
    if (models.length === 0 && typeof mongoose.modelNames === "function") {
      try {
        const modelNames = mongoose.modelNames();
        if (modelNames.length > 0) {
          const namedModels = modelNames
            .map(name => mongoose.model(name))
            .filter(Boolean);
          models.push(...namedModels);
          detectionMethod = "mongoose-modelNames";
        }
      } catch (error) {
        console.warn(
          "[Mongeese] Could not access models via mongoose.modelNames():",
          error
        );
      }
    }

    // Update diagnostics
    diagnostics.allModelNames = [...new Set(models.map(m => m.modelName))];

    // Get connection states
    if (mongoose.connection) {
      const stateNames: { [key: number]: string } = {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting",
      };
      diagnostics.defaultConnectionState = `${
        mongoose.connection.readyState
      } (${stateNames[mongoose.connection.readyState] || "unknown"})`;
    }

    // Validate all detected models
    const validModels = models.filter(model => {
      if (
        !model ||
        typeof model.find !== "function" ||
        typeof model.findOne !== "function"
      ) {
        console.warn(
          `[Mongeese] Invalid model detected: ${
            model?.modelName || "unnamed"
          } (missing required methods)`
        );
        return false;
      }
      return true;
    });

    return {
      models: validModels,
      detectionMethod,
      diagnostics,
    };
  } catch (error) {
    console.error("[Mongeese] Error in advanced model detection:", error);
    return {
      models: [],
      detectionMethod: "error",
      diagnostics,
    };
  }
}

/**
 * Force model loading with multiple strategies
 */
async function forceModelLoading(config: ModelDetectionConfig = {}): Promise<{
  loadedFiles: string[];
  errors: Array<{ file: string; error: any }>;
  discoveredFiles: string[];
}> {
  const errors: Array<{ file: string; error: any }> = [];
  let loadedFiles: string[] = [];
  let discoveredFiles: string[] = [];

  try {
    // Discover files using our improved discovery
    discoveredFiles = await discoverModelFiles(config);

    if (discoveredFiles.length === 0) {
      console.warn("\n[Mongeese] ⚠️ No model files discovered");
      return { loadedFiles, errors, discoveredFiles };
    }

    console.log(
      `\n[Mongeese] 📁 Found ${discoveredFiles.length} potential model files`
    );

    // Load files and track results
    const loadResult = await loadModelFiles(discoveredFiles, config);

    loadedFiles = loadResult.loaded;

    errors.push(...loadResult.errors);

    console.log(
      `\n[Mongeese] ✅ Successfully loaded ${loadedFiles.length} model files`
    );

    if (errors.length > 0) {
      console.warn(`\n[Mongeese] ⚠️ Failed to load ${errors.length} files:`);
      errors.forEach(({ file, error }) => {
        console.warn(
          `   • ${path.relative(process.cwd(), file)}: ${
            error.message || error
          }`
        );
      });
    }
  } catch (error) {
    errors.push({ file: "discovery", error });
  }

  return { loadedFiles, errors, discoveredFiles };
}

/**
 * Wait for models to be registered (with timeout)
 */
async function waitForModelsRegistration(
  timeoutMs: number = 2000
): Promise<Model<any>[]> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = detectRegisteredModelsAdvanced();

    if (result.models.length > 0) {
      return result.models;
    }

    // Wait a bit before checking again
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.warn(
    `[Mongeese] ⏱️ Timeout waiting for model registration (${timeoutMs}ms)`
  );
  return [];
}

/**
 * Ensure Mongoose connection is established before model detection
 */
async function ensureMongooseConnection(): Promise<boolean> {
  try {
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      return true;
    }

    // If connecting, wait a bit
    if (mongoose.connection.readyState === 2) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      // @ts-ignore
      return mongoose.connection.readyState === ConnectionStates.connected;
    }

    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Attempts to discover model files using glob patterns
 * Automatically uses NestJS patterns if NestJS project is detected
 */
export async function discoverModelFiles(
  config: ModelDetectionConfig = {}
): Promise<string[]> {
  const isNestJS = isNestJSProject();

  // Automatically use NestJS-specific patterns if detected
  const defaultPaths = isNestJS
    ? [
        // Primary NestJS patterns
        "**/*.schema.{js,ts}",
        "**/schemas/**/*.{js,ts}",

        // Alternative NestJS patterns
        "**/entities/**/*.{js,ts}", // Some use entities folder
        "**/dto/**/*.{js,ts}", // Sometimes DTOs contain schemas

        // Module-specific patterns
        "**/modules/**/schemas/**/*.{js,ts}",
        "**/modules/**/*.schema.{js,ts}",
        "**/src/**/schemas/**/*.{js,ts}",
        "**/src/**/*.schema.{js,ts}",

        // Monorepo patterns
        "**/apps/**/schemas/**/*.{js,ts}",
        "**/libs/**/schemas/**/*.{js,ts}",
        "**/packages/**/schemas/**/*.{js,ts}",
      ]
    : [
        // Standard Mongoose patterns
        "**/models/**/*.{js,ts}",
        "**/model/**/*.{js,ts}",
        "**/schemas/**/*.{js,ts}",
        "**/schema/**/*.{js,ts}",
        "**/*model*.{js,ts}",
        "**/*schema*.{js,ts}",
      ];

  const patterns = config.modelPaths || defaultPaths;

  if (isNestJS) {
    console.log("[Mongeese] 🔍 Using NestJS-optimized file discovery patterns");
  }

  const allFiles: string[] = [];

  for (const pattern of patterns) {
    try {
      const files = await glob(pattern, {
        ignore: [
          "**/node_modules/**",
          "**/dist/**",
          "**/build/**",
          "**/*.spec.ts",
          "**/*.test.ts",
          "**/*.d.ts",
        ],
        absolute: true,
      });
      allFiles.push(...files);
    } catch (error) {
      console.warn(`[Mongeese] Failed to glob pattern ${pattern}:`, error);
    }
  }

  // Remove duplicates and log found files
  const uniqueFiles = [...new Set(allFiles)];

  if (uniqueFiles.length > 0) {
    console.log(
      `[Mongeese] 📁 Found ${uniqueFiles.length} potential model files`
    );
    if (process.env.DEBUG) {
      uniqueFiles.slice(0, 5).forEach(file => {
        console.log(`   • ${path.relative(process.cwd(), file)}`);
      });
      if (uniqueFiles.length > 5) {
        console.log(`   • ... and ${uniqueFiles.length - 5} more`);
      }
    }
  } else {
    console.log("[Mongeese] ⚠️  No model files found with current patterns");
    if (isNestJS) {
      console.log("   💡 Make sure your schema files end with .schema.ts");
      console.log(
        "   💡 Check that schemas are in a 'schemas' folder or similar"
      );
    }
  }

  return uniqueFiles;
}

/**
 * Load a model file with compatibility for both CommonJS and ES modules
 */
async function loadModelFile(filePath: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const isESProject = isESModuleProject(process.cwd());

  // If it's an ES module project and a .js file, we need to use dynamic import
  if (isESProject && filePath.endsWith(".js")) {
    try {
      // Convert to file URL for proper ES module import
      const fileUrl =
        process.platform === "win32"
          ? `file:///${resolvedPath.replace(/\\/g, "/")}`
          : `file://${resolvedPath}`;

      // Use Function constructor to avoid TypeScript issues with dynamic import
      const importFn = new Function("specifier", "return import(specifier)");
      await importFn(fileUrl);
      return;
    } catch (importError) {
      throw new Error(
        `Failed to import ES module ${filePath}: ${
          importError instanceof Error
            ? importError.message
            : String(importError)
        }`
      );
    }
  }

  // For CommonJS projects, .cjs files, or .ts files, use require
  try {
    // Clear require cache for fresh load
    if (typeof require !== "undefined" && require.cache) {
      delete require.cache[resolvedPath];
    }

    require(resolvedPath);
  } catch (requireError) {
    // Check if this is the ES module error
    const errorMessage =
      requireError instanceof Error
        ? requireError.message
        : String(requireError);

    if (errorMessage.includes("require() of ES Module")) {
      throw new Error(
        `Cannot require ES module ${filePath}. ` +
          `Your project has "type": "module" in package.json. ` +
          `Consider renaming model files to .cjs extension or using ES module syntax.`
      );
    }

    throw requireError;
  }
}

/**
 * Loads model files and attempts to register them with Mongoose
 */
export async function loadModelFiles(
  filePaths: string[],
  config: ModelDetectionConfig = {}
): Promise<{ loaded: string[]; errors: Array<{ file: string; error: any }> }> {
  const loaded: string[] = [];
  const errors: Array<{ file: string; error: any }> = [];
  const requireModels = config.require !== false;

  if (!requireModels) {
    console.warn("[Mongeese] Model file loading is disabled");
    return { loaded, errors };
  }

  const isESProject = isESModuleProject(process.cwd());

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];

    // Add progress logging for large numbers of files
    if (filePaths.length > 10 && i % 10 === 0) {
      console.log(`[Mongeese] Loading model files... ${i}/${filePaths.length}`);
    }

    try {
      await loadModelFile(filePath);
      loaded.push(filePath);
    } catch (error) {
      // Enhanced error logging for ES module issues
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("ES module") ||
        errorMessage.includes("require() of ES Module")
      ) {
        console.warn(
          `[Mongeese] ES Module compatibility issue with ${filePath}. ` +
            `Consider renaming to .cjs or updating to ES module syntax.`
        );
      }

      errors.push({ file: filePath, error });
    }
  }

  console.log(
    `[Mongeese] Completed loading: ${loaded.length} successful, ${errors.length} failed`
  );

  // Log ES module specific guidance if there were errors in an ES project
  if (isESProject && errors.length > 0) {
    const esModuleErrors = errors.filter(
      e =>
        (e.error instanceof Error && e.error.message.includes("ES module")) ||
        (typeof e.error === "string" && e.error.includes("ES module"))
    );

    if (esModuleErrors.length > 0) {
      console.log(
        `\n[Mongeese] ES Module Project Detected - ${esModuleErrors.length} files failed to load due to module system compatibility.\n` +
          `Solutions for model files:\n` +
          `1. Rename .js model files to .cjs (recommended)\n` +
          `2. Update model files to use ES module syntax (import/export)\n` +
          `3. Remove "type": "module" from package.json if not needed\n`
      );
    }
  }

  return { loaded, errors };
}

/**
 * Converts a Mongoose SchemaType to our field type system
 */
function mapMongooseTypeToFieldType(schemaType: SchemaType): string {
  const constructorName = schemaType.constructor.name;

  switch (constructorName) {
    case "SchemaString":
      return "String";
    case "SchemaNumber":
      return "Number";
    case "SchemaDate":
      return "Date";
    case "SchemaBoolean":
      return "Boolean";
    case "SchemaObjectId":
      return "ObjectId";
    case "SchemaArray":
      return "Array";
    case "SchemaBuffer":
      return "Buffer";
    case "SchemaMixed":
      return "Mixed";
    case "SchemaDecimal128":
      return "Decimal128";
    case "SchemaMap":
      return "Map";
    default:
      return "Unknown";
  }
}

/**
 * Extracts field definition from a Mongoose schema path
 */
function extractFieldDefinition(
  schemaType: SchemaType,
  path: string,
  includeVirtuals: boolean = false
): MongooseFieldInfo {
  const type = mapMongooseTypeToFieldType(schemaType);
  const options = schemaType.options || {};

  // Determine nullability and required status
  const required = !!schemaType.isRequired || !!options.required;
  const nullable = !required; // In Mongoose, if not required, it can be null/undefined

  // Extract default value
  const defaultValue = options.default;

  // Extract enum values for string fields
  const enumValues = options.enum
    ? Array.isArray(options.enum)
      ? [...options.enum]
      : typeof options.enum === "object" && options.enum !== null
      ? Object.values(options.enum)
      : undefined
    : undefined;

  // Extract validators
  const validators = schemaType.validators || [];

  const fieldDef: MongooseFieldInfo = {
    type,
    nullable,
    required,
    mongooseType: schemaType.constructor.name,
    schemaPath: path,
    validators: validators.length > 0 ? validators : undefined,
  };

  if (defaultValue !== undefined) {
    fieldDef.default = defaultValue;
  }

  if (enumValues && type === "String") {
    fieldDef.enum = enumValues;
  }

  return fieldDef;
}

/**
 * Converts Mongoose schema indexes to our index format
 */
function extractIndexes(schema: Schema): IndexDefinition[] {
  const indexes: IndexDefinition[] = [];

  // Get compound indexes
  const schemaIndexes = schema.indexes();

  for (const [indexSpec, options = {}] of schemaIndexes) {
    const fields = Object.entries(indexSpec).map(([field, direction]) => ({
      field,
      direction: direction as 1 | -1,
    }));

    const indexDef: IndexDefinition = {
      fields,
      unique:
        typeof options.unique === "object"
          ? options.unique[0]
          : options.unique || false,
      sparse: options.sparse || false,
    };

    // Add other index options if present
    if (options.partialFilterExpression) {
      indexDef.partialFilterExpression = options.partialFilterExpression;
    }
    if (options.expireAfterSeconds) {
      indexDef.expireAfterSeconds = options.expireAfterSeconds;
    }
    if (options.name) {
      indexDef.name = options.name;
    }

    indexes.push(indexDef);
  }

  return indexes;
}

export function detectRegisteredModels() {
  const result = detectRegisteredModelsAdvanced();

  return result.models;
}

/**
 * Generates a snapshot from Mongoose models registered in the current process
 */
export function generateSnapshotFromModels(
  models?: Model<any>[],
  config: ModelDetectionConfig = {}
): Snapshot {
  const detectedModels = models || detectRegisteredModels();

  if (detectedModels.length === 0) {
    console.warn("[Mongeese] No Mongoose models found in current process");

    process.exit(1);
  }

  const collections: { [collectionName: string]: CollectionStructure } = {};

  for (const model of detectedModels) {
    const schema = model.schema;

    const collectionName = model.collection.collectionName;

    const fields: { [fieldName: string]: FieldDefinition } = {};

    // Process schema paths (regular fields)
    schema.eachPath((path: string, schemaType: SchemaType) => {
      // Skip _id and __v unless explicitly included
      if (path === "_id" || path === "__v") {
        return;
      }

      fields[path] = extractFieldDefinition(
        schemaType,
        path,
        config.includeVirtuals
      );
    });

    // Process virtual fields if requested
    if (config.includeVirtuals) {
      const virtuals = schema.virtuals;
      for (const [path, virtual] of Object.entries(virtuals)) {
        if (path === "id") continue; // Skip default id virtual

        fields[path] = {
          type: "Virtual",
          nullable: true,
          required: false,
        };
      }
    }

    // Extract indexes
    const indexes = extractIndexes(schema);

    collections[collectionName] = { fields, indexes };
  }

  const snapshot: Snapshot = {
    version: 1,
    hash: "",
    collections,
    createdAt: new Date(),
  };

  // Generate hash (reuse the existing hash function)
  snapshot.hash = generateSnapshotHash(snapshot);

  return snapshot;
}

/**
 * Auto-discovers and loads Mongoose models, then generates a snapshot
 * Uses multiple detection strategies for maximum compatibility
 */
export async function generateSnapshotFromCodebase(
  config: ModelDetectionConfig = {}
): Promise<{
  snapshot: Snapshot;
  metadata: {
    discoveredFiles: string[];
    loadedFiles: string[];
    loadErrors: Array<{ file: string; error: any }>;
    detectedModels: string[];
    isNestJS: boolean;
    detectionMethod: string;
    diagnostics: any;
  };
}> {
  const isNestJS = isNestJSProject();

  let detectedModels: Model<any>[] = [];

  let discoveredFiles: string[] = [];

  let loadedFiles: string[] = [];

  let loadErrors: Array<{ file: string; error: any }> = [];

  let detectionMethod = "unknown";

  let diagnostics: any = {};

  try {
    await ensureMongooseConnection();

    // // Strategy 1: Try to detect already registered models first
    // const initialDetection = detectRegisteredModelsAdvanced();

    // if (initialDetection.models.length > 0) {
    //   detectedModels = initialDetection.models;

    //   detectionMethod = `pre-existing-${initialDetection.detectionMethod}`;
    // }

    // diagnostics = initialDetection.diagnostics;

    // Strategy 2: NestJS-specific detection if no models found yet
    if (detectedModels.length === 0 && isNestJS) {
      console.log("\n[Mongeese] NestJS project detected");

      try {
        const nestjsConfig = {
          ...config,
          nestjs: {
            bootstrap: true,
            alwaysDiscoverFiles: false,
            includeEntities: true,
            ...config.nestjs,
          },
        };

        const nestjsResult = await generateNestJSSnapshot(nestjsConfig);

        if (nestjsResult.models.length > 0) {
          detectedModels = nestjsResult.models;

          loadErrors = [...loadErrors, ...nestjsResult.errors];

          detectionMethod = `nestjs-${nestjsResult.metadata.detectionMethod}`;

          console.log(
            `\n[Mongeese] ✅ NestJS detection successful: ${detectedModels.length} models`
          );
        }
        // else {
        //   console.log(
        //     "[Mongeese] NestJS detection found no models, falling back to standard detection"
        //   );
        // }
      } catch (nestjsError) {
        console.warn("[Mongeese] NestJS detection failed:", nestjsError);
        loadErrors.push({ file: "nestjs-detection", error: nestjsError });
      }
    }

    // Strategy 3: Standard file discovery and loading
    if (detectedModels.length === 0) {
      console.log("\n[Mongeese] 📁 Searching for Mongoose models...");

      const loadingResult = await forceModelLoading(config);

      discoveredFiles = loadingResult.discoveredFiles;

      loadedFiles = loadingResult.loadedFiles;

      loadErrors = [...loadErrors, ...loadingResult.errors];

      // Wait a moment for models to register after loading
      if (loadedFiles.length > 0) {
        detectedModels = await waitForModelsRegistration(5000); // Increased timeout

        if (detectedModels.length > 0) {
          const finalDetection = detectRegisteredModelsAdvanced();

          detectionMethod = `file-loading-${finalDetection.detectionMethod}`;

          diagnostics = { ...diagnostics, ...finalDetection.diagnostics };
        } else {
          // Try forcing a connection check after model loading
          console.log(
            "\n[Mongeese] 🔄 Rechecking connection state after model loading..."
          );
          await ensureMongooseConnection();

          // One more attempt after connection check
          detectedModels = await waitForModelsRegistration(2000);

          if (detectedModels.length > 0) {
            const finalDetection = detectRegisteredModelsAdvanced();

            detectionMethod = `reconnect-${finalDetection.detectionMethod}`;

            diagnostics = { ...diagnostics, ...finalDetection.diagnostics };
          } else {
            detectionMethod = "file-loading-failed";
          }
        }
      }
    }

    // Strategy 4: Last resort - comprehensive model detection
    if (detectedModels.length === 0) {
      console.log("[Mongeese] 🔄 Attempting comprehensive model detection...");

      const finalDetection = detectRegisteredModelsAdvanced();

      detectedModels = finalDetection.models;

      detectionMethod = `final-attempt-${finalDetection.detectionMethod}`;

      diagnostics = { ...diagnostics, ...finalDetection.diagnostics };
    }

    // Final results
    console.log(
      `\n[Mongeese] ✅ Detection completed: ${detectedModels.length} models found`
    );

    if (detectedModels.length <= 0) {
      console.error("[Mongeese] ❌ No models detected");
      console.log("[Mongeese] 🔧 Debug information:");
      console.log(JSON.stringify(diagnostics, null, 2));

      console.log("\n[Mongeese] 💡 Troubleshooting suggestions:");
      console.log("   1. Check that your models are properly exported");
      console.log("   2. Ensure model files follow naming conventions");
      console.log("   3. Verify mongoose connection is established");
      console.log("   4. Try manually importing a model file to test");
      console.log("   5. Check that MONGODB_URI environment variable is set");
      console.log(
        "   6. Ensure your model files call mongoose.model() to register models"
      );

      if (diagnostics.defaultConnectionState?.includes("0 (disconnected)")) {
        console.log("\n[Mongeese] 🔥 CRITICAL: Mongoose is disconnected!");
        console.log("   • Models cannot register without an active connection");
        console.log("   • Set MONGODB_URI environment variable");
        console.log("   • Or establish connection before running mongeese");
      }

      if (isNestJS) {
        console.log("   7. Check NestJS module configuration");
        console.log("   8. Ensure @Schema() decorators are applied");
        console.log("   9. Verify MongooseModule.forFeature() is used");
      }

      process.exit(1);
    }

    const snapshot = generateSnapshotFromModels(detectedModels, config);

    return {
      snapshot,
      metadata: {
        discoveredFiles,
        loadedFiles,
        loadErrors,
        detectedModels: detectedModels.map(
          m => `${m.modelName} -> ${m.collection.collectionName}`
        ),
        isNestJS,
        detectionMethod,
        diagnostics,
      },
    };
  } catch (error) {
    console.error(
      "[Mongeese] ❌ Critical error during snapshot generation:",
      error
    );
    throw error;
  }
}

/**
 * Compares code-based snapshot with database snapshot to detect changes
 */
export function compareCodeToDatabase(
  codeSnapshot: Snapshot,
  dbSnapshot: Snapshot
): {
  hasChanges: boolean;
  summary: {
    collections: { added: string[]; removed: string[]; modified: string[] };
    fields: { added: string[]; removed: string[]; modified: string[] };
  };
} {
  const hasChanges = codeSnapshot.hash !== dbSnapshot.hash;

  const summary = {
    collections: {
      added: [] as string[],
      removed: [] as string[],
      modified: [] as string[],
    },
    fields: {
      added: [] as string[],
      removed: [] as string[],
      modified: [] as string[],
    },
  };

  // Compare collections
  const codeCollections = new Set(Object.keys(codeSnapshot.collections));
  const dbCollections = new Set(Object.keys(dbSnapshot.collections));

  // Added collections (in code but not in DB)
  for (const collection of codeCollections) {
    if (!dbCollections.has(collection)) {
      summary.collections.added.push(collection);
    }
  }

  // Removed collections (in DB but not in code)
  for (const collection of dbCollections) {
    if (!codeCollections.has(collection)) {
      summary.collections.removed.push(collection);
    }
  }

  // Modified collections (exist in both but different)
  for (const collection of codeCollections) {
    if (dbCollections.has(collection)) {
      const codeCollection = codeSnapshot.collections[collection];
      const dbCollection = dbSnapshot.collections[collection];

      // Simple comparison - in practice you'd want more sophisticated field comparison
      if (JSON.stringify(codeCollection) !== JSON.stringify(dbCollection)) {
        summary.collections.modified.push(collection);

        // Track field-level changes
        const codeFields = new Set(Object.keys(codeCollection.fields));
        const dbFields = new Set(Object.keys(dbCollection.fields));

        for (const field of codeFields) {
          if (!dbFields.has(field)) {
            summary.fields.added.push(`${collection}.${field}`);
          }
        }

        for (const field of dbFields) {
          if (!codeFields.has(field)) {
            summary.fields.removed.push(`${collection}.${field}`);
          } else if (
            JSON.stringify(codeCollection.fields[field]) !==
            JSON.stringify(dbCollection.fields[field])
          ) {
            summary.fields.modified.push(`${collection}.${field}`);
          }
        }
      }
    }
  }

  return { hasChanges, summary };
}
