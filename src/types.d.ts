import { ObjectId, Db, MongoClient } from "mongodb";

// DbWithClient type that extends Db with an attached client property
export interface DbWithClient extends Db {
  client: MongoClient;
}

// Field definition with type information
export interface FieldDefinition {
  type: string; // e.g., "String", "Number", "ObjectId", "Unknown"

  nullable: boolean; // true if field can be null or undefined

  required: boolean; // true if field is present in all documents

  default?: any; // default value if all values are the same

  enum?: string[]; // enum values for string fields

  nestedFields?: { [name: string]: FieldDefinition }; // for nested object fields
}

// Enhanced index definition with all MongoDB options
export interface IndexDefinition {
  fields: Array<{ field: string; direction: 1 | -1 }>;

  unique?: boolean;

  sparse?: boolean;

  partialFilterExpression?: any;

  expireAfterSeconds?: number;

  collation?: any;

  text?: boolean;

  geoHaystack?: boolean;

  bucketSize?: number;

  min?: number;

  max?: number;

  bits?: number;

  name?: string;
}

// Enhanced collection structure with validators
export interface CollectionStructure {
  fields: {
    [fieldName: string]: FieldDefinition;
  };
  indexes?: IndexDefinition[];
  validator?: {
    $jsonSchema: any;
  };
  validationLevel?: "off" | "strict" | "moderate";
  validationAction?: "error" | "warn";
}

export type SnapshotCollections = {
  [collectionName: string]: CollectionStructure;
};

// Snapshot format for in-memory comparison (no longer stored in database)
export interface Snapshot {
  _id?: ObjectId; // Optional for backward compatibility
  createdAt: Date;
  hash: string; // SHA256 hash of deterministically serialized snapshot
  version: number; // Schema version for evolution
  collections: SnapshotCollections;
}

// Migration format for storage (updated to remove snapshot references)
export interface Migration {
  _id?: ObjectId;
  name: string; // e.g., "2025_08_02_add_user_age"
  from: {
    _id?: ObjectId; // No longer used but kept for backward compatibility
    hash: string; // SHA256 of snapshot content
  };
  to: {
    _id?: ObjectId; // No longer used but kept for backward compatibility
    hash: string;
  };
  up: string[]; // Array of Mongo shell commands
  down: string[]; // Reverse commands
  createdAt: Date;
  isApplied?: boolean;
  appliedAt?: Date | null;
  executionTime?: number | null;
  filename?: string; // Migration filename for tracking
}

export type SnapshotError = { collection: string; error: any };

export type FieldMap = { [path: string]: string };

// Migration command types
export interface MigrationCommand {
  metadata?: any;
  command: string;
  description: string;
  safetyLevel: "safe" | "warning" | "dangerous";
}

export interface DiffResult {
  up: MigrationCommand[];
  down: MigrationCommand[];
  warnings: string[];
  metadata: {
    collections: {
      added: string[];
      removed: string[];
      modified: string[];
    };
    fields: {
      added: string[];
      removed: string[];
      modified: string[];
      renamed: Array<{ from: string; to: string }>;
    };
    indexes: {
      added: string[];
      removed: string[];
      modified: string[];
    };
    validators: {
      added: string[];
      removed: string[];
      modified: string[];
    };
  };
}

// Enhanced collection structure with validators
export interface EnhancedCollectionStructure extends CollectionStructure {
  validator?: {
    $jsonSchema: any;
  };
  validationLevel?: "off" | "strict" | "moderate";
  validationAction?: "error" | "warn";
}

// Normalized snapshot for consistent hashing
export interface NormalizedSnapshot {
  version: number;
  collections: { [name: string]: EnhancedCollectionStructure };
}

export interface GenerateMigrationOptions {
  name?: string;
}

export interface MigrateOptions {
  direction?: "up" | "down";
  target?: string; // Migration filename or timestamp
  dry?: boolean;
  force?: boolean;
}

export interface MigrationRecord {
  _id?: any;
  filename: string;
  appliedAt: Date;
  direction: "up" | "down";
  executionTime: number; // milliseconds
}

// Extended field definition to capture Mongoose-specific information
export interface MongooseFieldInfo extends FieldDefinition {
  mongooseType?: string;
  schemaPath?: string;
  validators?: any[];
  transform?: boolean;
  virtual?: boolean;
}

export interface ModelDetectionConfig {
  modelPaths?: string[];
  require?: boolean;
  includeVirtuals?: boolean;

  // NestJS-specific options
  nestjs?: {
    // Whether to attempt bootstrapping the NestJS app (most reliable)
    bootstrap?: boolean;

    // Whether to always discover schema files even after successful bootstrap
    alwaysDiscoverFiles?: boolean;

    // Custom app module path (if not standard)
    appModulePath?: string;

    // Whether to include entity files (some projects use entities instead of schemas)
    includeEntities?: boolean;

    // Custom schema file patterns for NestJS projects
    schemaPatterns?: string[];
  };
}

// Configuration file interface
export interface MongeesConfig {
  // Database connection
  database?: {
    uri?: string;
    options?: any;
  };

  // Model detection settings
  detection?: ModelDetectionConfig;

  // Migration settings
  migrations?: {
    directory?: string;
    tableName?: string;
  };

  // NestJS-specific settings
  nestjs?: {
    configModule?: string;
    bootstrap?: boolean;
  };
}

// Field summary statistics for efficient processing
export interface FieldStats {
  totalDocuments: number; // Total documents sampled
  presentCount: number; // Documents where field exists (even if null/undefined)
  nullCount: number; // Documents where field is explicitly null
  undefinedCount: number; // Documents where field is explicitly undefined
  typeSet: Set<string>; // Types of non-nullish values
  valueSet: Set<string>; // For detecting defaults
}

// Simplified field detection for database comparison
export interface DatabaseFieldInfo {
  exists: boolean;
  hasNullValues: boolean;
  hasUndefinedValues: boolean;
  sampleCount: number;
  presentCount: number;
}
