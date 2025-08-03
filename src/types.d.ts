import { ObjectId } from "mongodb";

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

// Canonical snapshot format for storage
export interface Snapshot {
  _id?: ObjectId;
  createdAt: Date;
  hash: string; // SHA256 hash of deterministically serialized snapshot
  version: number; // Schema version for evolution
  collections: SnapshotCollections;
}

// Migration format for storage
export interface Migration {
  _id?: ObjectId;
  id: string; // e.g., "2025_08_02_add_user_age"
  from: {
    _id: ObjectId; // DB reference
    hash: string; // SHA256 of snapshot content
  };
  to: {
    _id: ObjectId;
    hash: string;
  };
  up: string[]; // Array of Mongo shell commands
  down: string[]; // Reverse commands
  createdAt: Date;
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
