import { ObjectId } from "mongodb";

// Field definition with type information
export interface FieldDefinition {
  type: string; // e.g., "String", "Number", "ObjectId", "Unknown"
  nullable: boolean; // true if field can be null or undefined
  required: boolean; // true if field is present in all documents
  default?: any; // default value if all values are the same
  enum?: string[]; // enum values for string fields
}

// Collection structure with fields and indexes
export interface CollectionStructure {
  fields: {
    [fieldName: string]: FieldDefinition;
  };
  indexes?: {
    fields: string[];
    unique?: boolean;
    sparse?: boolean;
  }[];
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
