import {
  Snapshot,
  CollectionStructure,
  FieldDefinition,
  SnapshotError,
} from "../types";
import pLimit from "p-limit";
import { flatten } from "../utilities/flatten";
import { Collection, Document, Db } from "mongodb";
import { createHash } from "crypto";
import {
  createFieldStats,
  updateFieldStats,
  inferFieldType,
  inferRequired,
  inferNullable,
  inferDefault,
  inferEnum,
  FieldStats,
} from "../utilities/detect-field-type";

// Helper function to check if a document has nested objects that need flattening
function hasNestedStructure(obj: any, depth: number = 0): boolean {
  if (depth > 3) return false; // Limit recursion depth

  if (obj === null || obj === undefined || typeof obj !== "object") {
    return false;
  }

  if (Array.isArray(obj)) {
    return obj.some(item => hasNestedStructure(item, depth + 1));
  }

  // Check if any value is an object (excluding Date, ObjectId, etc.)
  for (const value of Object.values(obj)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "object") {
      // Skip known non-nested types
      if (
        value instanceof Date ||
        (value as any)._bsontype === "ObjectID" ||
        (value as any).$oid ||
        Buffer.isBuffer(value)
      ) {
        continue;
      }

      // Found a nested object
      return true;
    }
  }

  return false;
}

async function snapCollection(
  collections: { [collectionName: string]: CollectionStructure },
  collection: Collection<Document>,
  errors: SnapshotError[]
) {
  try {
    const samples = await collection
      .aggregate([{ $sample: { size: 50 } }])
      .toArray();

    if (samples.length === 0) {
      // Empty collection, create minimal structure
      collections[collection.collectionName] = {
        fields: {},
        indexes: [],
      };
      return;
    }

    const fields: { [fieldName: string]: FieldDefinition } = {};

    const fieldStats: { [fieldName: string]: FieldStats } = {};

    // Process all samples in one pass, tracking summary stats
    for (const doc of samples) {
      // Check if document contains nested objects that need flattening
      const hasNestedObjects = hasNestedStructure(doc);

      if (hasNestedObjects) {
        // Only flatten if necessary
        const flattened: { [path: string]: any } = {};

        flatten(doc, "", flattened);

        // Track all possible field paths from all documents
        for (const path of Object.keys(flattened)) {
          if (!fieldStats[path]) {
            fieldStats[path] = createFieldStats();
          }
        }

        // Update stats for this document's fields
        for (const [path, value] of Object.entries(flattened)) {
          updateFieldStats(fieldStats[path], value, true);
        }

        // Update stats for missing fields in this document
        for (const [path, stats] of Object.entries(fieldStats)) {
          if (!(path in flattened)) {
            updateFieldStats(stats, undefined, false);
          }
        }
      } else {
        // Process flat document directly without flattening
        const docKeys = Object.keys(doc);

        // Track all possible field paths from all documents
        for (const path of docKeys) {
          if (!fieldStats[path]) {
            fieldStats[path] = createFieldStats();
          }
        }

        // Update stats for this document's fields
        for (const [path, value] of Object.entries(doc)) {
          updateFieldStats(fieldStats[path], value, true);
        }

        // Update stats for missing fields in this document
        for (const [path, stats] of Object.entries(fieldStats)) {
          if (!(path in doc)) {
            updateFieldStats(stats, undefined, false);
          }
        }
      }
    }

    // Analyze each field using the collected stats
    for (const [fieldName, stats] of Object.entries(fieldStats)) {
      const type = inferFieldType(stats);

      const required = inferRequired(stats);

      const nullable = inferNullable(stats);

      const defaultValue = inferDefault(stats);

      const enumValues = type === "String" ? inferEnum(stats) : undefined;

      fields[fieldName] = {
        type,
        nullable,
        required,
        ...(defaultValue !== undefined && { default: defaultValue }),
        ...(enumValues && { enum: enumValues }),
      };
    }

    // Get indexes
    const dbIndexes = await collection.indexes();

    const indexes = dbIndexes
      .filter(index => index.name !== "_id_") // Skip _id index
      .map(index => ({
        fields: Object.entries(index.key).map(([field, direction]) => ({
          field,
          direction: direction as 1 | -1,
        })),
        unique: index.unique || false,
        sparse: index.sparse || false,
      }));

    collections[collection.collectionName] = { fields, indexes };
  } catch (error) {
    errors.push({ collection: collection.collectionName, error });

    console.error(
      `[Mongeese] Failed to snapshot collection '${collection.collectionName}':`,
      error
    );
  }
}

// Deterministic serialization for hashing
function serializeSnapshot(snapshot: Snapshot): string {
  const { _id, hash, createdAt, ...content } = snapshot;

  // Sort collections alphabetically
  const sortedCollections: { [key: string]: CollectionStructure } = {};

  Object.keys(content.collections)
    .sort()
    .forEach(key => {
      sortedCollections[key] = content.collections[key];
    });

  // Sort fields within each collection
  Object.keys(sortedCollections).forEach(collectionName => {
    const collection = sortedCollections[collectionName];
    const sortedFields: { [key: string]: FieldDefinition } = {};

    Object.keys(collection.fields)
      .sort()
      .forEach(fieldName => {
        sortedFields[fieldName] = collection.fields[fieldName];
      });

    collection.fields = sortedFields;
  });

  return JSON.stringify(
    { ...content, collections: sortedCollections },
    null,
    0
  );
}

// Generate SHA256 hash of snapshot content
function generateSnapshotHash(snapshot: Snapshot): string {
  const serialized = serializeSnapshot(snapshot);

  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Generates a snapshot of the current schema structure for all collections in the DB.
 * @param db MongoDB database connection
 * @param version Schema version number
 * @returns Promise<Snapshot>
 */
export async function generateSnapshot(
  db: Db,
  version: number = 1
): Promise<Snapshot> {
  const dbCollections = await db.collections();

  const collections: {
    [collectionName: string]: CollectionStructure;
  } = {};

  const errors: SnapshotError[] = [];

  // Use concurrency limit for up to 50 collections, otherwise fall back to sequential
  if (dbCollections.length > 50) {
    // Too many collections, process sequentially to avoid DB overload
    for (const collection of dbCollections) {
      await snapCollection(collections, collection, errors);
    }
  } else {
    // Use p-limit to control concurrency (limit to 5 at a time)
    const limit = pLimit(5);

    await Promise.all(
      dbCollections.map(collection =>
        limit(async () => {
          await snapCollection(collections, collection, errors);
        })
      )
    );
  }

  if (errors.length > 0) {
    console.warn(
      `[Mongeese] Snapshot completed with ${errors.length} collection errors.`
    );
  }

  const snapshot: Snapshot = {
    version,
    hash: "",
    collections,
    createdAt: new Date(),
  };

  // Generate hash after creating the snapshot
  snapshot.hash = generateSnapshotHash(snapshot);

  return snapshot;
}

/**
 * Verifies that a snapshot's hash matches its content
 * @param snapshot The snapshot to verify
 * @returns boolean True if hash is valid
 */
export function verifySnapshot(snapshot: Snapshot): boolean {
  const computedHash = generateSnapshotHash(snapshot);
  return computedHash === snapshot.hash;
}
