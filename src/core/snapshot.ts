import {
  Snapshot,
  CollectionStructure,
  FieldDefinition,
  SnapshotError,
  DatabaseFieldInfo,
} from "../types";
import pLimit from "p-limit";
import { flatten } from "../utilities/flatten";
import { Collection, Document, Db } from "mongodb";
import { createHash } from "crypto";

// Fields that Mongoose manages automatically and should be filtered out
const MONGOOSE_MANAGED_FIELDS = new Set(["_id", "__v"]);

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
        Buffer.isBuffer(value) ||
        (value as any)._bsontype === "Decimal128" ||
        (value as any)._bsontype === "Long" ||
        (value as any)._bsontype === "BinData"
      ) {
        continue;
      }

      // Found a nested object
      return true;
    }
  }

  return false;
}

/**
 * Database-focused collection snapshotting for comparison purposes
 * Filters out Mongoose-managed fields and focuses on field presence
 */
async function snapCollectionForComparison(
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
    const fieldInfo: { [fieldName: string]: DatabaseFieldInfo } = {};

    // Process all samples to track field presence (not type accuracy)
    for (const doc of samples) {
      // Check if document contains nested objects that need flattening
      const hasNestedObjects = hasNestedStructure(doc);

      let docFields: { [path: string]: any } = {};

      if (hasNestedObjects) {
        // Flatten nested documents
        flatten(doc, "", docFields);
      } else {
        // Use document directly
        docFields = doc;
      }

      // Filter out Mongoose-managed fields
      const filteredFields = Object.fromEntries(
        Object.entries(docFields).filter(
          ([fieldName]) => !MONGOOSE_MANAGED_FIELDS.has(fieldName)
        )
      );

      // Track all possible field paths from all documents (excluding Mongoose fields)
      for (const path of Object.keys(filteredFields)) {
        if (!fieldInfo[path]) {
          fieldInfo[path] = {
            exists: false,
            hasNullValues: false,
            hasUndefinedValues: false,
            sampleCount: 0,
            presentCount: 0,
          };
        }
      }

      // Update field presence info
      for (const [path, info] of Object.entries(fieldInfo)) {
        info.sampleCount++;

        if (path in filteredFields) {
          info.presentCount++;
          info.exists = true;

          const value = filteredFields[path];
          if (value === null) {
            info.hasNullValues = true;
          }
          if (value === undefined) {
            info.hasUndefinedValues = true;
          }
        }
      }
    }

    // Create basic field definitions focused on presence, not type accuracy
    for (const [fieldName, info] of Object.entries(fieldInfo)) {
      // For database comparison, we only care about:
      // 1. Does the field exist in any documents?
      // 2. Is it present in all documents (required-ish)?
      // 3. Can it be null/undefined?

      const isRequiredInDb = info.presentCount === info.sampleCount;
      const isNullableInDb = info.hasNullValues || info.hasUndefinedValues;

      fields[fieldName] = {
        type: "Mixed", // We don't care about accurate types for comparison
        nullable: isNullableInDb,
        required: isRequiredInDb,
        // Don't add default values or enums - those come from code
      };
    }

    // Get indexes (this part stays accurate since it's metadata)
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

    console.log(
      `   📊 Collection '${collection.collectionName}': ${
        Object.keys(fields).length
      } fields detected (Mongoose fields filtered)`
    );
  } catch (error) {
    errors.push({ collection: collection.collectionName, error });

    console.error(
      `[Mongeese] Failed to snapshot collection '${collection.collectionName}':`,
      error
    );
  }
}

// Keep the same serialization and hashing functions
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

export function generateSnapshotHash(snapshot: Snapshot): string {
  const serialized = serializeSnapshot(snapshot);
  return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Generates a database snapshot optimized for comparison with code snapshots
 * Automatically filters out Mongoose-managed fields (_id, __v)
 * @param db MongoDB database connection
 * @param version Schema version number
 * @returns Promise<Snapshot>
 */
export async function generateDatabaseSnapshot(
  db: Db,
  version: number = 1
): Promise<Snapshot> {
  console.log("[Mongeese] 📊 Generating database snapshot for comparison...");

  const dbCollections = await db.collections();

  // Exclude Mongeese's own collections
  const filteredCollections = dbCollections.filter(
    c =>
      c.collectionName !== "mongeese.snapshots" &&
      c.collectionName !== "mongeese.migrations"
  );

  const collections: {
    [collectionName: string]: CollectionStructure;
  } = {};

  const errors: SnapshotError[] = [];

  // Use concurrency limit for up to 50 collections, otherwise fall back to sequential
  if (filteredCollections.length > 50) {
    // Too many collections, process sequentially to avoid DB overload
    for (const collection of filteredCollections) {
      await snapCollectionForComparison(collections, collection, errors);
    }
  } else {
    // Use p-limit to control concurrency (limit to 5 at a time)
    const limit = pLimit(5);

    await Promise.all(
      filteredCollections.map(collection =>
        limit(async () => {
          await snapCollectionForComparison(collections, collection, errors);
        })
      )
    );
  }

  if (errors.length > 0) {
    console.warn(
      `[Mongeese] Database snapshot completed with ${errors.length} collection errors.`
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

// Keep the legacy function for backward compatibility, but point to the new approach
export async function generateSnapshot(
  db: Db,
  version: number = 1
): Promise<Snapshot> {
  // console.warn(
  //   "[Mongeese] ⚠️  generateSnapshot is deprecated. Use generateDatabaseSnapshot for comparison or generateSnapshotFromCodebase for accurate schema detection."
  // );
  return generateDatabaseSnapshot(db, version);
}
