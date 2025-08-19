import mongoose, { Schema, SchemaType, Model } from "mongoose";
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
import { generateSnapshotHash } from "./snapshot";
import { generateNestJSSnapshot } from "./nestjs-detection";

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

    // Method 2: Check for NestJS-specific files
    const nestjsFiles = [
      "src/app.module.ts",
      "src/main.ts",
      "apps/*/src/app.module.ts", // Monorepo structure
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
 * Detects Mongoose models in the current Node.js process
 */
export function detectRegisteredModels(): Model<any>[] {
  return Object.values(mongoose.models) as Model<any>[];
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

  console.log(
    `[Mongeese] Attempting to load ${filePaths.length} model files...`
  );

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];

    // Add progress logging for large numbers of files
    if (filePaths.length > 10 && i % 10 === 0) {
      console.log(`[Mongeese] Loading model files... ${i}/${filePaths.length}`);
    }

    try {
      // Clear require cache to ensure fresh load
      delete require.cache[path.resolve(filePath)];

      // Require the file
      require(filePath);
      loaded.push(filePath);
    } catch (error) {
      errors.push({ file: filePath, error });
    }
  }

  console.log(
    `[Mongeese] Completed loading: ${loaded.length} successful, ${errors.length} failed`
  );
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
  }

  const collections: { [collectionName: string]: CollectionStructure } = {};

  for (const model of detectedModels) {
    const schema = model.schema;
    const collectionName = model.collection.collectionName;

    console.log(
      `[Mongeese] Processing model: ${model.modelName} -> ${collectionName}`
    );

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
 * Automatically detects NestJS projects and uses appropriate detection method
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
    detectionMethod?: string;
  };
}> {
  console.log("[Mongeese] Auto-discovering Mongoose models...");

  const isNestJS = isNestJSProject();

  try {
    let detectedModels: Model<any>[] = [];
    let discoveredFiles: string[] = [];
    let loadedFiles: string[] = [];
    let loadErrors: Array<{ file: string; error: any }> = [];
    let detectionMethod = "standard";

    if (isNestJS) {
      console.log(
        "[Mongeese] 🚀 NestJS project detected - using enhanced detection"
      );

      // Automatically use NestJS detection with sensible defaults
      const nestjsConfig = {
        ...config,
        nestjs: {
          bootstrap: true,
          alwaysDiscoverFiles: false,
          includeEntities: true,
          ...config.nestjs, // Allow override if user provides nestjs config
        },
      };

      const nestjsResult = await generateNestJSSnapshot(nestjsConfig);
      detectedModels = nestjsResult.models;
      loadErrors = nestjsResult.errors;
      detectionMethod = nestjsResult.metadata.detectionMethod;

      console.log(
        `[Mongeese] ✅ NestJS detection completed using: ${detectionMethod}`
      );
      console.log(`[Mongeese] 📊 Found ${detectedModels.length} models`);
    } else {
      console.log("[Mongeese] 📁 Standard Mongoose project detected");
    }

    // Fallback to standard detection if no models found
    if (detectedModels.length === 0) {
      console.log("[Mongeese] 🔄 Falling back to standard model detection...");

      // Discover model files
      discoveredFiles = await discoverModelFiles(config);

      console.log(
        `[Mongeese] 📂 Discovered ${discoveredFiles.length} potential model files`
      );

      // Load model files
      const loadResult = await loadModelFiles(discoveredFiles, config);
      loadedFiles = loadResult.loaded;
      loadErrors = [...loadErrors, ...loadResult.errors];

      console.log(
        `[Mongeese] ✅ Successfully loaded ${loadedFiles.length} model files`
      );

      if (loadErrors.length > 0) {
        console.warn(
          `[Mongeese] ⚠️  Failed to load ${loadErrors.length} model files`
        );
        // Log specific errors in debug mode
        if (process.env.DEBUG) {
          loadErrors.forEach(({ file, error }) => {
            console.warn(`   - ${path.basename(file)}: ${error.message}`);
          });
        }
      }

      // Generate snapshot from loaded models
      detectedModels = detectRegisteredModels();
      detectionMethod = isNestJS ? "nestjs-fallback" : "standard";
    }

    console.log(
      `[Mongeese] 🎯 Final result: ${detectedModels.length} registered models`
    );

    // Log detected models for debugging
    if (detectedModels.length > 0) {
      console.log("[Mongeese] 📋 Detected models:");
      detectedModels.forEach(model => {
        console.log(
          `   • ${model.modelName} → ${model.collection.collectionName}`
        );
      });
    } else {
      console.log("[Mongeese] ❌ No models detected. Please check:");
      console.log("   • Your models are properly exported");
      console.log("   • Model files follow naming conventions");
      if (isNestJS) {
        console.log("   • Your NestJS modules are properly configured");
        console.log("   • @Schema() decorators are applied to your classes");
      }
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
      },
    };
  } catch (error) {
    console.error("[Mongeese] ❌ Error during snapshot generation:", error);
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
