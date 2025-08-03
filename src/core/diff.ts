import {
  Snapshot,
  NormalizedSnapshot,
  FieldDefinition,
  IndexDefinition,
  DiffResult,
  MigrationCommand,
  EnhancedCollectionStructure,
} from "../types";

/**
 * Normalize snapshot for deterministic serialization
 */
export function normalizeSnapshot(snapshot: Snapshot): NormalizedSnapshot {
  const normalized: NormalizedSnapshot = {
    version: snapshot.version,
    collections: {},
  };

  // Sort collections alphabetically
  const sortedCollectionNames = Object.keys(snapshot.collections).sort();

  for (const collectionName of sortedCollectionNames) {
    const collection = snapshot.collections[collectionName];
    const normalizedCollection: EnhancedCollectionStructure = {
      fields: {},
      indexes: [],
    };

    // Sort fields alphabetically
    const sortedFieldNames = Object.keys(collection.fields).sort();
    for (const fieldName of sortedFieldNames) {
      normalizedCollection.fields[fieldName] = collection.fields[fieldName];
    }

    // Sort indexes by canonical representation
    if (collection.indexes) {
      normalizedCollection.indexes = collection.indexes
        .map(normalizeIndex)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }

    normalized.collections[collectionName] = normalizedCollection;
  }

  return normalized;
}

/**
 * Normalize index definition for consistent comparison
 */
function normalizeIndex(index: any): IndexDefinition {
  return {
    fields: Array.isArray(index.fields)
      ? index.fields.map((f: any) =>
          typeof f === "string" ? { field: f, direction: 1 } : f
        )
      : Object.entries(index.fields || {}).map(([field, direction]) => ({
          field,
          direction: direction as 1 | -1,
        })),
    unique: index.unique || false,
    sparse: index.sparse || false,
    partialFilterExpression: index.partialFilterExpression,
    expireAfterSeconds: index.expireAfterSeconds,
    collation: index.collation,
    text: index.text || false,
    geoHaystack: index.geoHaystack || false,
    bucketSize: index.bucketSize,
    min: index.min,
    max: index.max,
    bits: index.bits,
    name: index.name,
  };
}

/**
 * Get all field paths from a collection (including nested)
 */
function getAllFieldPaths(fields: {
  [name: string]: FieldDefinition;
}): string[] {
  const paths: string[] = [];

  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    paths.push(fieldName);

    // Handle nested object fields
    if (fieldDef.type === "Object" && fieldDef.nestedFields) {
      for (const nestedPath of Object.keys(fieldDef.nestedFields)) {
        paths.push(`${fieldName}.${nestedPath}`);
      }
    }
  }

  return paths.sort();
}

/**
 * Compare two field definitions
 */
function compareFields(
  from: FieldDefinition,
  to: FieldDefinition
): {
  changed: boolean;
  changes: string[];
} {
  const changes: string[] = [];

  if (from.type !== to.type) {
    changes.push(`type: ${from.type} → ${to.type}`);
  }

  if (from.nullable !== to.nullable) {
    changes.push(`nullable: ${from.nullable} → ${to.nullable}`);
  }

  if (from.required !== to.required) {
    changes.push(`required: ${from.required} → ${to.required}`);
  }

  // Compare defaults (including function defaults)
  const fromDefault = JSON.stringify(from.default);

  const toDefault = JSON.stringify(to.default);

  if (fromDefault !== toDefault) {
    changes.push(`default: ${fromDefault} → ${toDefault}`);
  }

  // Compare enums
  const fromEnum = JSON.stringify(from.enum?.sort());

  const toEnum = JSON.stringify(to.enum?.sort());

  if (fromEnum !== toEnum) {
    changes.push(`enum: ${fromEnum} → ${toEnum}`);
  }

  return { changed: changes.length > 0, changes };
}

/**
 * Detect field renames based on type and metadata similarity
 */
function detectFieldRenames(
  fromFields: { [name: string]: FieldDefinition },
  toFields: { [name: string]: FieldDefinition }
): Array<{ from: string; to: string; confidence: number }> {
  const renames: Array<{ from: string; to: string; confidence: number }> = [];

  const fromFieldNames = Object.keys(fromFields);

  const toFieldNames = Object.keys(toFields);

  for (const fromName of fromFieldNames) {
    if (toFields[fromName]) continue; // Field still exists

    const fromField = fromFields[fromName];

    let bestMatch: { name: string; confidence: number } | null = null;

    for (const toName of toFieldNames) {
      if (fromFields[toName]) continue; // Field existed before

      const toField = toFields[toName];

      let confidence = 0;

      // Type match
      if (fromField.type === toField.type) confidence += 0.4;

      // Nullable match
      if (fromField.nullable === toField.nullable) confidence += 0.2;

      // Required match
      if (fromField.required === toField.required) confidence += 0.2;

      // Default value match
      if (JSON.stringify(fromField.default) === JSON.stringify(toField.default))
        confidence += 0.1;

      // Enum match
      if (
        JSON.stringify(fromField.enum?.sort()) ===
        JSON.stringify(toField.enum?.sort())
      )
        confidence += 0.1;

      if (
        confidence > 0.7 &&
        (!bestMatch || confidence > bestMatch.confidence)
      ) {
        bestMatch = { name: toName, confidence };
      }
    }

    if (bestMatch) {
      renames.push({
        from: fromName,
        to: bestMatch.name,
        confidence: bestMatch.confidence,
      });
    }
  }

  return renames;
}

/**
 * Diff collections (add/remove collections)
 */
function diffCollections(
  fromCollections: { [name: string]: EnhancedCollectionStructure },
  toCollections: { [name: string]: EnhancedCollectionStructure }
): { up: MigrationCommand[]; down: MigrationCommand[]; warnings: string[] } {
  const up: MigrationCommand[] = [];

  const down: MigrationCommand[] = [];

  const warnings: string[] = [];

  const fromNames = Object.keys(fromCollections);

  const toNames = Object.keys(toCollections);

  // Added collections
  for (const collectionName of toNames) {
    if (!fromNames.includes(collectionName)) {
      up.push({
        command: `db.createCollection("${collectionName}")`,
        description: `Create collection '${collectionName}'`,
        safetyLevel: "safe",
      });

      down.push({
        command: `db.${collectionName}.drop()`,
        description: `Drop collection '${collectionName}'`,
        safetyLevel: "dangerous",
        metadata: { collectionName },
      });

      warnings.push(`⚠️  Will create new collection '${collectionName}'`);
    }
  }

  // Removed collections
  for (const collectionName of fromNames) {
    if (!toNames.includes(collectionName)) {
      up.push({
        command: `db.${collectionName}.drop()`,
        description: `Drop collection '${collectionName}'`,
        safetyLevel: "dangerous",
        metadata: { collectionName },
      });

      down.push({
        command: `db.createCollection("${collectionName}")`,
        description: `Recreate collection '${collectionName}'`,
        safetyLevel: "safe",
      });

      warnings.push(
        `⚠️  Will drop collection '${collectionName}' - ensure it's empty or use --force`
      );
    }
  }

  return { up, down, warnings };
}

/**
 * Diff fields within a collection
 */
function diffFields(
  collectionName: string,
  fromFields: { [name: string]: FieldDefinition },
  toFields: { [name: string]: FieldDefinition }
): { up: MigrationCommand[]; down: MigrationCommand[]; warnings: string[] } {
  const up: MigrationCommand[] = [];

  const down: MigrationCommand[] = [];

  const warnings: string[] = [];

  const fromPaths = getAllFieldPaths(fromFields);

  const toPaths = getAllFieldPaths(toFields);

  // Detect renames first
  const renames = detectFieldRenames(fromFields, toFields);

  const renamedFrom = new Set(renames.map(r => r.from));

  const renamedTo = new Set(renames.map(r => r.to));

  // Added fields
  for (const fieldPath of toPaths) {
    // If it wasn't in the old snapshot and it wasn't renamed
    if (!fromPaths.includes(fieldPath) && !renamedTo.has(fieldPath)) {
      // Find the field definition by traversing the path
      const pathParts = fieldPath.split(".");

      let currentField: FieldDefinition | undefined = toFields[pathParts[0]];

      // Handle nested fields
      for (let i = 1; i < pathParts.length && currentField; i++) {
        currentField = currentField.nestedFields?.[pathParts[i]];
      }

      if (!currentField) continue; // Skip if field definition not found

      const fieldDef = currentField;

      const defaultValue =
        fieldDef.default !== undefined
          ? JSON.stringify(fieldDef.default)
          : "null";

      up.push({
        command: `db.${collectionName}.updateMany({}, { $set: { "${fieldPath}": ${defaultValue} } })`,
        description: `Add field '${fieldPath}' to collection '${collectionName}'`,
        safetyLevel: "safe",
        metadata: { fieldPath, fieldDefinition: fieldDef as FieldDefinition },
      });

      down.push({
        command: `db.${collectionName}.updateMany({}, { $unset: { "${fieldPath}": "" } })`,
        description: `Remove field '${fieldPath}' from collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: { fieldPath },
      });
    }
  }

  // Removed fields
  for (const fieldPath of fromPaths) {
    if (!toPaths.includes(fieldPath) && !renamedFrom.has(fieldPath)) {
      const fieldDef = fromFields[fieldPath];

      up.push({
        command: `db.${collectionName}.updateMany({}, { $unset: { "${fieldPath}": "" } })`,
        description: `Remove field '${fieldPath}' from collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: { fieldPath },
      });

      down.push({
        command: `db.${collectionName}.updateMany({}, { $set: { "${fieldPath}": ${JSON.stringify(
          fieldDef.default || null
        )} } })`,
        description: `Restore field '${fieldPath}' to collection '${collectionName}'`,
        safetyLevel: "safe",
        metadata: { fieldPath, fieldDefinition: fieldDef },
      });

      warnings.push(
        `⚠️  Will remove field '${fieldPath}' from '${collectionName}'`
      );
    }
  }

  // Renamed fields
  for (const rename of renames) {
    up.push({
      command: `db.${collectionName}.updateMany({}, { $rename: { "${rename.from}": "${rename.to}" } })`,
      description: `Rename field '${rename.from}' to '${rename.to}' in collection '${collectionName}'`,
      safetyLevel: "safe",
      metadata: {
        from: rename.from,
        to: rename.to,
        confidence: rename.confidence,
      },
    });

    down.push({
      command: `db.${collectionName}.updateMany({}, { $rename: { "${rename.to}": "${rename.from}" } })`,
      description: `Rename field '${rename.to}' back to '${rename.from}' in collection '${collectionName}'`,
      safetyLevel: "safe",
      metadata: { from: rename.to, to: rename.from },
    });
  }

  // Modified fields
  for (const fieldPath of fromPaths) {
    if (toPaths.includes(fieldPath) && !renamedFrom.has(fieldPath)) {
      // Find field definitions by traversing the path
      const pathParts = fieldPath.split(".");

      let fromField = fromFields[pathParts[0]];

      let toField = toFields[pathParts[0]];

      // Handle nested fields
      for (let i = 1; i < pathParts.length; i++) {
        if (fromField?.nestedFields?.[pathParts[i]]) {
          fromField = fromField?.nestedFields?.[pathParts[i]];
        }

        if (toField?.nestedFields?.[pathParts[i]]) {
          toField = toField?.nestedFields?.[pathParts[i]];
        }
      }

      if (!fromField || !toField) continue; // Skip if either field not found

      const comparison = compareFields(
        fromField as FieldDefinition,
        toField as FieldDefinition
      );

      if (comparison.changed) {
        // For field modifications, we need to handle type changes carefully
        if (
          (fromField as FieldDefinition).type !==
          (toField as FieldDefinition).type
        ) {
          warnings.push(
            `⚠️  Type change for '${fieldPath}' in '${collectionName}': ${
              (fromField as FieldDefinition).type
            } → ${
              (toField as FieldDefinition).type
            } - may require data migration`
          );
        }

        up.push({
          command: `// Field '${fieldPath}' modified: ${comparison.changes.join(
            ", "
          )}`,
          description: `Modify field '${fieldPath}' in collection '${collectionName}'`,
          safetyLevel: "warning",
          metadata: {
            fieldPath,
            changes: comparison.changes,
            fromField: fromField as FieldDefinition,
            toField: toField as FieldDefinition,
          },
        });

        down.push({
          command: `// Restore field '${fieldPath}' to previous state`,
          description: `Restore field '${fieldPath}' in collection '${collectionName}'`,
          safetyLevel: "warning",
          metadata: {
            fieldPath,
            fieldDefinition: fromField as FieldDefinition,
          },
        });
      }
    }
  }

  return { up, down, warnings };
}

/**
 * Compare two index definitions
 */
function compareIndexes(from: IndexDefinition, to: IndexDefinition): boolean {
  const fromStr = JSON.stringify(normalizeIndex(from));

  const toStr = JSON.stringify(normalizeIndex(to));

  return fromStr === toStr;
}

/**
 * Generate index creation command
 */
function generateIndexCommand(
  collectionName: string,
  index: IndexDefinition
): string {
  const fields = index.fields
    .map(f => `"${f.field}": ${f.direction}`)
    .join(", ");

  const options: string[] = [];

  if (index.unique) {
    options.push("unique: true");
  }

  if (index.sparse) {
    options.push("sparse: true");
  }

  if (index.partialFilterExpression) {
    options.push(
      `partialFilterExpression: ${JSON.stringify(
        index.partialFilterExpression
      )}`
    );
  }

  if (index.expireAfterSeconds !== undefined) {
    options.push(`expireAfterSeconds: ${index.expireAfterSeconds}`);
  }

  if (index.collation) {
    options.push(`collation: ${JSON.stringify(index.collation)}`);
  }

  if (index.text) {
    options.push("text: true");
  }

  if (index.geoHaystack) {
    options.push("geoHaystack: true");
  }

  if (index.bucketSize) {
    options.push(`bucketSize: ${index.bucketSize}`);
  }

  if (index.min !== undefined) {
    options.push(`min: ${index.min}`);
  }

  if (index.max !== undefined) {
    options.push(`max: ${index.max}`);
  }

  if (index.bits) {
    options.push(`bits: ${index.bits}`);
  }

  if (index.name) {
    options.push(`name: "${index.name}"`);
  }

  const optionsStr = options.length > 0 ? `, { ${options.join(", ")} }` : "";

  return `db.${collectionName}.createIndex({ ${fields} }${optionsStr})`;
}

/**
 * Diff indexes within a collection
 */
function diffIndexes(
  collectionName: string,
  fromIndexes: IndexDefinition[],
  toIndexes: IndexDefinition[]
): { up: MigrationCommand[]; down: MigrationCommand[]; warnings: string[] } {
  const up: MigrationCommand[] = [];

  const down: MigrationCommand[] = [];

  const warnings: string[] = [];

  // Added indexes
  for (const toIndex of toIndexes) {
    const indexExists = fromIndexes.some(fromIndex =>
      compareIndexes(fromIndex, toIndex)
    );

    if (!indexExists) {
      up.push({
        command: generateIndexCommand(collectionName, toIndex),
        description: `Create index on collection '${collectionName}'`,
        safetyLevel: "safe",
        metadata: { index: toIndex },
      });

      const indexName =
        toIndex.name || toIndex.fields.map(f => f.field).join("_");

      down.push({
        command: `db.${collectionName}.dropIndex("${indexName}")`,
        description: `Drop index from collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: { indexName, index: toIndex },
      });
    }
  }

  // Removed indexes
  for (const fromIndex of fromIndexes) {
    const indexExists = toIndexes.some(toIndex =>
      compareIndexes(fromIndex, toIndex)
    );

    if (!indexExists) {
      const indexName =
        fromIndex.name || fromIndex.fields.map(f => f.field).join("_");

      up.push({
        command: `db.${collectionName}.dropIndex("${indexName}")`,
        description: `Drop index from collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: { indexName, index: fromIndex },
      });

      down.push({
        command: generateIndexCommand(collectionName, fromIndex),
        description: `Recreate index on collection '${collectionName}'`,
        safetyLevel: "safe",
        metadata: { index: fromIndex },
      });

      warnings.push(
        `⚠️  Will drop index '${indexName}' from '${collectionName}'`
      );
    }
  }

  return { up, down, warnings };
}

/**
 * Diff validators within a collection
 */
function diffValidators(
  collectionName: string,
  fromValidator: any,
  toValidator: any
): { up: MigrationCommand[]; down: MigrationCommand[]; warnings: string[] } {
  const up: MigrationCommand[] = [];

  const down: MigrationCommand[] = [];

  const warnings: string[] = [];

  const fromStr = JSON.stringify(fromValidator);

  const toStr = JSON.stringify(toValidator);

  if (fromStr !== toStr) {
    if (toValidator) {
      up.push({
        command: `db.runCommand({ collMod: "${collectionName}", validator: ${JSON.stringify(
          toValidator
        )} })`,
        description: `Update validator for collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: { validator: toValidator },
      });
    } else {
      up.push({
        command: `db.runCommand({ collMod: "${collectionName}", validator: {} })`,
        description: `Remove validator from collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: {},
      });
    }

    if (fromValidator) {
      down.push({
        command: `db.runCommand({ collMod: "${collectionName}", validator: ${JSON.stringify(
          fromValidator
        )} })`,
        description: `Restore validator for collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: { validator: fromValidator },
      });
    } else {
      down.push({
        command: `db.runCommand({ collMod: "${collectionName}", validator: {} })`,
        description: `Remove validator from collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: {},
      });
    }

    warnings.push(
      `⚠️  Will modify validator for collection '${collectionName}'`
    );
  }

  return { up, down, warnings };
}

/**
 * Main diff function that orchestrates all diffing operations
 */
export function diffSnapshots(from: Snapshot, to: Snapshot): DiffResult {
  const normalizedFrom = normalizeSnapshot(from);

  const normalizedTo = normalizeSnapshot(to);

  const allUp: MigrationCommand[] = [];

  const allDown: MigrationCommand[] = [];

  const allWarnings: string[] = [];

  const metadata: DiffResult["metadata"] = {
    collections: { added: [], removed: [], modified: [] },
    fields: { added: [], removed: [], modified: [], renamed: [] },
    indexes: { added: [], removed: [], modified: [] },
    validators: { added: [], removed: [], modified: [] },
  };

  // Diff collections
  const collectionDiff = diffCollections(
    normalizedFrom.collections,
    normalizedTo.collections
  );

  allUp.push(...collectionDiff.up);

  allDown.push(...collectionDiff.down);

  allWarnings.push(...collectionDiff.warnings);

  // Track collection changes
  const fromCollectionNames = Object.keys(normalizedFrom.collections);

  const toCollectionNames = Object.keys(normalizedTo.collections);

  metadata.collections.added = toCollectionNames.filter(
    name => !fromCollectionNames.includes(name)
  );

  metadata.collections.removed = fromCollectionNames.filter(
    name => !toCollectionNames.includes(name)
  );

  metadata.collections.modified = fromCollectionNames.filter(name =>
    toCollectionNames.includes(name)
  );

  // Diff fields, indexes, and validators for each collection
  for (const collectionName of metadata.collections.modified) {
    const fromCollection = normalizedFrom.collections[collectionName];

    const toCollection = normalizedTo.collections[collectionName];

    // Diff fields
    const fieldDiff = diffFields(
      collectionName,
      fromCollection.fields,
      toCollection.fields
    );

    allUp.push(...fieldDiff.up);

    allDown.push(...fieldDiff.down);

    allWarnings.push(...fieldDiff.warnings);

    // Diff indexes
    const indexDiff = diffIndexes(
      collectionName,
      fromCollection.indexes || [],
      toCollection.indexes || []
    );

    allUp.push(...indexDiff.up);

    allDown.push(...indexDiff.down);

    allWarnings.push(...indexDiff.warnings);

    // Diff validators
    const validatorDiff = diffValidators(
      collectionName,
      fromCollection.validator,
      toCollection.validator
    );

    allUp.push(...validatorDiff.up);

    allDown.push(...validatorDiff.down);
    allWarnings.push(...validatorDiff.warnings);
  }

  // Wrap in transaction if multiple operations
  if (allUp.length > 1) {
    const transactionUp = [
      {
        command: "const session = db.getMongo().startSession();",
        description: "Start transaction session",
        safetyLevel: "safe" as const,
      },
      {
        command: "session.startTransaction();",
        description: "Begin transaction",
        safetyLevel: "safe" as const,
      },
      ...allUp,
      {
        command: "await session.commitTransaction();",
        description: "Commit transaction",
        safetyLevel: "safe" as const,
      },
      {
        command: "session.endSession();",
        description: "End session",
        safetyLevel: "safe" as const,
      },
    ];

    const transactionDown = [
      {
        command: "const session = db.getMongo().startSession();",
        description: "Start transaction session",
        safetyLevel: "safe" as const,
      },
      {
        command: "session.startTransaction();",
        description: "Begin transaction",
        safetyLevel: "safe" as const,
      },
      ...allDown,
      {
        command: "await session.commitTransaction();",
        description: "Commit transaction",
        safetyLevel: "safe" as const,
      },
      {
        command: "session.endSession();",
        description: "End session",
        safetyLevel: "safe" as const,
      },
    ];

    return {
      up: transactionUp,
      down: transactionDown,
      warnings: allWarnings,
      metadata,
    };
  }

  return {
    up: allUp,
    down: allDown,
    warnings: allWarnings,
    metadata,
  };
}
