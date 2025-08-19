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
 * Enhanced field diffing with code-first approach and smart default handling
 */
function diffFieldsCodeFirst(
  collectionName: string,
  dbFields: { [name: string]: FieldDefinition }, // Database snapshot (comparison only)
  codeFields: { [name: string]: FieldDefinition } // Code snapshot (source of truth)
): { up: MigrationCommand[]; down: MigrationCommand[]; warnings: string[] } {
  const up: MigrationCommand[] = [];

  const down: MigrationCommand[] = [];

  const warnings: string[] = [];

  const dbFieldNames = new Set(Object.keys(dbFields));

  const codeFieldNames = new Set(Object.keys(codeFields));

  console.log(
    `[Mongeese] 🔍 Diffing fields for collection '${collectionName}'`
  );
  console.log(`   📊 Database has ${dbFieldNames.size} fields`);
  console.log(`   💻 Code defines ${codeFieldNames.size} fields`);

  // NEW FIELDS: In code but not in database
  for (const fieldName of codeFieldNames) {
    if (!dbFieldNames.has(fieldName)) {
      const codeField = codeFields[fieldName];

      console.log(
        `   ➕ New field detected: '${fieldName}' (${codeField.type})`
      );

      // Smart default value handling
      let migrationValue: any = null;
      let description = `Add field '${fieldName}' to collection '${collectionName}'`;

      if (codeField.default !== undefined) {
        // Use the default value from code definition
        migrationValue = codeField.default;
        description += ` with default value`;

        console.log(
          `     🎯 Using code default: ${JSON.stringify(migrationValue)}`
        );
      } else if (!codeField.nullable && codeField.required) {
        // Field is required and non-nullable but has no default
        // We need to provide a sensible default based on type
        switch (codeField.type) {
          case "String":
            migrationValue = "";
            break;
          case "Number":
            migrationValue = 0;
            break;
          case "Boolean":
            migrationValue = false;
            break;
          case "Date":
            migrationValue = new Date();
            break;
          case "Array":
            migrationValue = [];
            break;
          case "Object":
            migrationValue = {};
            break;
          default:
            migrationValue = null;
        }

        console.log(
          `     ⚡ Generated default for required field: ${JSON.stringify(
            migrationValue
          )}`
        );
        description += ` with generated default (required field)`;

        warnings.push(
          `⚠️  Field '${fieldName}' in '${collectionName}' is required but has no default. Using type-based default: ${JSON.stringify(
            migrationValue
          )}`
        );
      } else {
        // Field is optional or nullable, use null
        migrationValue = null;
        console.log(`     ✅ Optional field, using null default`);
      }

      up.push({
        command: `db.collection("${collectionName}").updateMany({}, { $set: { "${fieldName}": ${JSON.stringify(
          migrationValue
        )} } })`,
        description,
        safetyLevel: "safe",
        metadata: {
          fieldPath: fieldName,
          fieldDefinition: codeField,
          migrationValue,
          reason: "new_field",
        },
      });

      down.push({
        command: `db.collection("${collectionName}").updateMany({}, { $unset: { "${fieldName}": "" } })`,
        description: `Remove field '${fieldName}' from collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: { fieldPath: fieldName, reason: "rollback_new_field" },
      });
    }
  }

  // REMOVED FIELDS: In database but not in code
  for (const fieldName of dbFieldNames) {
    if (!codeFieldNames.has(fieldName)) {
      console.log(`   ➖ Removed field detected: '${fieldName}'`);

      const dbField = dbFields[fieldName];

      up.push({
        command: `db.collection("${collectionName}").updateMany({}, { $unset: { "${fieldName}": "" } })`,
        description: `Remove field '${fieldName}' from collection '${collectionName}' (no longer in code)`,
        safetyLevel: "warning",
        metadata: { fieldPath: fieldName, reason: "field_removed_from_code" },
      });

      down.push({
        command: `db.collection("${collectionName}").updateMany({}, { $set: { "${fieldName}": null } })`,
        description: `Restore field '${fieldName}' to collection '${collectionName}'`,
        safetyLevel: "safe",
        metadata: {
          fieldPath: fieldName,
          fieldDefinition: dbField,
          reason: "restore_removed_field",
        },
      });

      warnings.push(
        `⚠️  Field '${fieldName}' exists in database but not in code. Will be removed.`
      );
    }
  }

  // MODIFIED FIELDS: Exist in both but may have different characteristics
  // NOTE: For modified fields, we trust the code definition completely
  // We only generate migrations for structural changes that affect the database
  for (const fieldName of codeFieldNames) {
    if (dbFieldNames.has(fieldName)) {
      const codeField = codeFields[fieldName];
      const dbField = dbFields[fieldName];

      const comparison = compareFields(dbField, codeField);

      if (comparison.changed) {
        console.log(
          `   🔄 Modified field: '${fieldName}' - ${comparison.changes.join(
            ", "
          )}`
        );

        // For most field property changes (type, nullable, required, enum),
        // we don't need to modify existing data - Mongoose will handle validation
        // Only generate migrations for changes that require data transformation

        const hasTypeChange = comparison.changes.some(change =>
          change.startsWith("type:")
        );
        const hasDefaultChange = comparison.changes.some(change =>
          change.startsWith("default:")
        );

        if (hasTypeChange) {
          warnings.push(
            `⚠️  Type change for '${fieldName}' in '${collectionName}': ${dbField.type} → ${codeField.type}. Existing data may need manual migration.`
          );

          up.push({
            command: `// TODO: Migrate data for type change: ${fieldName} (${dbField.type} → ${codeField.type})`,
            description: `Field '${fieldName}' type changed - may require data migration`,
            safetyLevel: "warning",
            metadata: {
              fieldPath: fieldName,
              changes: comparison.changes,
              fromField: dbField,
              toField: codeField,
              reason: "type_change",
            },
          });

          down.push({
            command: `// TODO: Revert data migration for: ${fieldName} (${codeField.type} → ${dbField.type})`,
            description: `Revert type change for field '${fieldName}'`,
            safetyLevel: "warning",
            metadata: {
              fieldPath: fieldName,
              fieldDefinition: dbField,
              reason: "revert_type_change",
            },
          });
        } else {
          // For non-type changes, just log that the schema definition changed
          up.push({
            command: `// Schema updated: ${fieldName} - ${comparison.changes.join(
              ", "
            )}`,
            description: `Field '${fieldName}' definition updated in code`,
            safetyLevel: "safe",
            metadata: {
              fieldPath: fieldName,
              changes: comparison.changes,
              fromField: dbField,
              toField: codeField,
              reason: "schema_definition_change",
            },
          });

          down.push({
            command: `// Schema reverted: ${fieldName}`,
            description: `Revert field '${fieldName}' definition`,
            safetyLevel: "safe",
            metadata: {
              fieldPath: fieldName,
              fieldDefinition: dbField,
              reason: "revert_schema_change",
            },
          });
        }
      }
    }
  }

  console.log(`   ✅ Field diff completed: ${up.length} migrations generated`);

  return { up, down, warnings };
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
        command: `db.collection("${collectionName}").drop()`,
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
        command: `db.collection("${collectionName}").drop()`,
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
        command: `db.collection("${collectionName}").updateMany({}, { $set: { "${fieldPath}": ${defaultValue} } })`,
        description: `Add field '${fieldPath}' to collection '${collectionName}'`,
        safetyLevel: "safe",
        metadata: { fieldPath, fieldDefinition: fieldDef as FieldDefinition },
      });

      down.push({
        command: `db.collection("${collectionName}").updateMany({}, { $unset: { "${fieldPath}": "" } })`,
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
        command: `db.collection("${collectionName}").updateMany({}, { $unset: { "${fieldPath}": "" } })`,
        description: `Remove field '${fieldPath}' from collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: { fieldPath },
      });

      down.push({
        command: `db.collection("${collectionName}").updateMany({}, { $set: { "${fieldPath}": ${JSON.stringify(
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
      command: `db.collection("${collectionName}").updateMany({}, { $rename: { "${rename.from}": "${rename.to}" } })`,
      description: `Rename field '${rename.from}' to '${rename.to}' in collection '${collectionName}'`,
      safetyLevel: "safe",
      metadata: {
        from: rename.from,
        to: rename.to,
        confidence: rename.confidence,
      },
    });

    down.push({
      command: `db.collection("${collectionName}").updateMany({}, { $rename: { "${rename.to}": "${rename.from}" } })`,
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

  return `db.collection("${collectionName}").createIndex({ ${fields} }${optionsStr})`;
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
        command: `db.collection("${collectionName}").dropIndex("${indexName}")`,
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
        command: `db.collection("${collectionName}").dropIndex("${indexName}")`,
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
 * Inject session into MongoDB command for transaction support
 */
function injectSessionIntoCommand(command: string): string {
  // Skip comments
  if (command.trim().startsWith("//")) {
    return command;
  }

  // Handle db.collection(...).method(...) pattern
  if (command.includes("db.collection(")) {
    // Find the last closing parenthesis and inject session before it
    const lastParenIndex = command.lastIndexOf(")");

    if (lastParenIndex > -1) {
      // Check if there are already options
      const beforeLastParen = command.substring(0, lastParenIndex);

      const afterLastParen = command.substring(lastParenIndex);

      // Look for existing options object
      const optionsStart = beforeLastParen.lastIndexOf("{");

      const commaBeforeOptions = beforeLastParen.lastIndexOf(",");

      if (optionsStart > commaBeforeOptions) {
        // There's already an options object, add session to it
        return beforeLastParen + ", session" + afterLastParen;
      } else {
        // No options object, create one with session
        return beforeLastParen + ", { session }" + afterLastParen;
      }
    }
  }

  // Handle db.runCommand(...) pattern
  if (command.includes("db.runCommand(")) {
    const lastParenIndex = command.lastIndexOf(")");
    if (lastParenIndex > -1) {
      return (
        command.substring(0, lastParenIndex) +
        ", { session }" +
        command.substring(lastParenIndex)
      );
    }
  }

  // Return unchanged for other commands
  return command;
}

/**
 * Enhanced diff function that treats code snapshot as source of truth
 * Database snapshot is used only for comparison to detect what needs migration
 */
export function diffSnapshots(
  dbSnapshot: Snapshot, // Database state (for comparison)
  codeSnapshot: Snapshot // Code state (source of truth)
): DiffResult {
  const normalizedDb = normalizeSnapshot(dbSnapshot);
  const normalizedCode = normalizeSnapshot(codeSnapshot);

  const allUp: MigrationCommand[] = [];

  const allDown: MigrationCommand[] = [];

  const allWarnings: string[] = [];

  const metadata: DiffResult["metadata"] = {
    collections: { added: [], removed: [], modified: [] },
    fields: { added: [], removed: [], modified: [], renamed: [] },
    indexes: { added: [], removed: [], modified: [] },
    validators: { added: [], removed: [], modified: [] },
  };

  // Diff collections (code is truth, database is current state)
  const collectionDiff = diffCollections(
    normalizedDb.collections,
    normalizedCode.collections
  );

  allUp.push(...collectionDiff.up);

  allDown.push(...collectionDiff.down);

  allWarnings.push(...collectionDiff.warnings);

  // Track collection changes
  const dbCollectionNames = Object.keys(normalizedDb.collections);
  const codeCollectionNames = Object.keys(normalizedCode.collections);

  metadata.collections.added = codeCollectionNames.filter(
    name => !dbCollectionNames.includes(name)
  );

  metadata.collections.removed = dbCollectionNames.filter(
    name => !codeCollectionNames.includes(name)
  );

  metadata.collections.modified = codeCollectionNames.filter(name =>
    dbCollectionNames.includes(name)
  );

  // Diff fields for each collection using code-first approach
  for (const collectionName of codeCollectionNames) {
    const codeCollection = normalizedCode.collections[collectionName];
    const dbCollection = normalizedDb.collections[collectionName];

    if (dbCollection) {
      // Collection exists in both - diff the fields
      const fieldDiff = diffFieldsCodeFirst(
        collectionName,
        dbCollection.fields, // Database state
        codeCollection.fields // Code state (truth)
      );

      allUp.push(...fieldDiff.up);
      allDown.push(...fieldDiff.down);
      allWarnings.push(...fieldDiff.warnings);
    }

    // No need to diff indexes or validators, mongoose does this under the hood! 🔥

    //   // Diff indexes
    //   const indexDiff = diffIndexes(
    //     collectionName,
    //     fromCollection.indexes || [],
    //     toCollection.indexes || []
    //   );

    //   allUp.push(...indexDiff.up);

    //   allDown.push(...indexDiff.down);

    //   allWarnings.push(...indexDiff.warnings);

    //   // Diff validators
    //   const validatorDiff = diffValidators(
    //     collectionName,
    //     fromCollection.validator,
    //     toCollection.validator
    //   );

    //   allUp.push(...validatorDiff.up);

    //   allDown.push(...validatorDiff.down);
    //   allWarnings.push(...validatorDiff.warnings);
  }

  // Add session support to all commands
  const up = allUp.map(cmd => ({
    ...cmd,
    command: injectSessionIntoCommand(cmd.command),
  }));

  const down = allDown.map(cmd => ({
    ...cmd,
    command: injectSessionIntoCommand(cmd.command),
  }));

  console.log(
    `[Mongeese] ✅ Diff completed: ${up.length} up migrations, ${down.length} down migrations`
  );

  console.log(`[Mongeese] ⚠️  Generated ${allWarnings.length} warnings`);

  return { up, down, warnings: allWarnings, metadata };
}
