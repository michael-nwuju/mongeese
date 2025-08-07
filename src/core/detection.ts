import mongoose, { Schema, SchemaType, Model } from "mongoose";
import * as fs from "fs";
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

/**
 * Detects Mongoose models in the current Node.js process
 */
export function detectRegisteredModels(): Model<any>[] {
  return Object.values(mongoose.models) as Model<any>[];
}

/**
 * Attempts to discover model files using glob patterns
 */
export async function discoverModelFiles(
  config: ModelDetectionConfig = {}
): Promise<string[]> {
  const defaultPaths = [
    "**/models/**/*.{js,ts}",
    "**/model/**/*.{js,ts}",
    "**/schemas/**/*.{js,ts}",
    "**/schema/**/*.{js,ts}",
    "**/*model*.{js,ts}",
    "**/*schema*.{js,ts}",
  ];

  const patterns = config.modelPaths || defaultPaths;

  const allFiles: string[] = [];

  for (const pattern of patterns) {
    try {
      const files = await glob(pattern, {
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
        absolute: true,
      });
      allFiles.push(...files);
    } catch (error) {
      console.warn(`[Mongeese] Failed to glob pattern ${pattern}:`, error);
    }
  }

  // Remove duplicates
  return [...new Set(allFiles)];
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

  for (const filePath of filePaths) {
    try {
      // Clear require cache to ensure fresh load
      delete require.cache[path.resolve(filePath)];

      // Require the file
      require(filePath);
      loaded.push(filePath);
    } catch (error) {
      errors.push({ file: filePath, error });
      if (
        error &&
        (error as any)?.code === "MODULE_NOT_FOUND" &&
        (error as any)?.message
      ) {
        console.warn(
          `[Mongeese] Failed to load model file ${filePath}: MODULE_NOT_FOUND (${
            (error as any)?.message
          })`
        );
      } else {
        console.warn(
          `[Mongeese] Failed to load model file ${filePath}:`,
          error
        );
      }
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
  const enumValues = options.enum ? [...options.enum] : undefined;

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

    // Exclude Mongeese's own collections
    if (
      collectionName === "mongeese.snapshots" ||
      collectionName === "mongeese.migrations"
    ) {
      continue;
    }

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
          //   virtual: true,
        };
      }
    }

    // Extract indexes
    const indexes = extractIndexes(schema);

    collections[collectionName] = {
      fields,
      indexes,
    };
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
  };
}> {
  console.log("[Mongeese] Auto-discovering Mongoose models...");

  // Discover model files
  const discoveredFiles = await discoverModelFiles(config);
  console.log(
    `[Mongeese] Discovered ${discoveredFiles.length} potential model files`
  );

  // Load model files
  const { loaded: loadedFiles, errors: loadErrors } = await loadModelFiles(
    discoveredFiles,
    config
  );
  console.log(
    `[Mongeese] Successfully loaded ${loadedFiles.length} model files`
  );

  if (loadErrors.length > 0) {
    console.warn(`[Mongeese] Failed to load ${loadErrors.length} model files`);
  }

  // Generate snapshot from loaded models
  const detectedModels = detectRegisteredModels();
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
    },
  };
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
