import {
  Snapshot,
  NormalizedSnapshot,
  FieldDefinition,
  IndexDefinition,
  DiffResult,
  MigrationCommand,
  EnhancedCollectionStructure,
} from "../types";

// Fields that are automatically managed by Mongoose and should be ignored
const MONGOOSE_MANAGED_FIELDS = new Set(["_id", "__v"]);

// Fields that are commonly auto-generated and we shouldn't warn about type changes
const AUTO_GENERATED_FIELDS = new Set(["_id", "__v", "createdAt", "updatedAt"]);

export function normalizeSnapshot(snapshot: Snapshot): NormalizedSnapshot {
  const normalized: NormalizedSnapshot = {
    version: snapshot.version,
    collections: {},
  };

  const sortedCollectionNames = Object.keys(snapshot.collections).sort();

  for (const collectionName of sortedCollectionNames) {
    const collection = snapshot.collections[collectionName];
    const normalizedCollection: EnhancedCollectionStructure = {
      fields: {},
      indexes: [],
    };

    if (collection.isEmpty) {
      normalizedCollection.isEmpty = collection.isEmpty;
    }

    // Filter out Mongoose-managed fields during normalization
    const sortedFieldNames = Object.keys(collection.fields)
      .filter(fieldName => !MONGOOSE_MANAGED_FIELDS.has(fieldName))
      .sort();

    for (const fieldName of sortedFieldNames) {
      normalizedCollection.fields[fieldName] = collection.fields[fieldName];
    }

    if (collection.indexes) {
      normalizedCollection.indexes = collection.indexes
        .map(normalizeIndex)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }

    normalized.collections[collectionName] = normalizedCollection;
  }

  return normalized;
}

function normalizeIndex(index: any): IndexDefinition {
  // Handle both database index format and schema index format
  const fields = Array.isArray(index.fields)
    ? index.fields.map((f: any) =>
        typeof f === "string" ? { field: f, direction: 1 } : f
      )
    : index.key
    ? // Database index format (from db.collection.getIndexes())
      Object.entries(index.key).map(([field, direction]) => ({
        field,
        direction: direction as 1 | -1,
      }))
    : // Schema index format
      Object.entries(index.fields || {}).map(([field, direction]) => ({
        field,
        direction: direction as 1 | -1,
      }));

  return {
    fields,
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

function getAllFieldPaths(fields: {
  [name: string]: FieldDefinition;
}): string[] {
  const paths: string[] = [];

  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    // Skip Mongoose-managed fields
    if (MONGOOSE_MANAGED_FIELDS.has(fieldName)) {
      continue;
    }

    paths.push(fieldName);

    if (fieldDef.type === "Object" && fieldDef.nestedFields) {
      for (const nestedPath of Object.keys(fieldDef.nestedFields)) {
        paths.push(`${fieldName}.${nestedPath}`);
      }
    }
  }

  return paths.sort();
}

function compareFields(
  from: FieldDefinition,
  to: FieldDefinition,
  fieldName: string
): {
  changed: boolean;
  changes: string[];
  significantChange: boolean; // Only changes that require migration
} {
  const changes: string[] = [];
  let significantChange = false;

  if (from.type !== "Mixed" && from.type !== to.type) {
    changes.push(`type: ${from.type} → ${to.type}`);
    // Only consider it significant if it's a real type change, not Mixed → ActualType
    // Also ignore type changes for auto-generated fields (they're usually correct in code)
    if (to.type !== "Mixed" && !AUTO_GENERATED_FIELDS.has(fieldName)) {
      significantChange = true;
    }
  }

  if (from.nullable !== to.nullable) {
    changes.push(`nullable: ${from.nullable} → ${to.nullable}`);
    // Nullable changes don't require data migration
  }

  if (from.required !== to.required) {
    changes.push(`required: ${from.required} → ${to.required}`);
    // Required changes don't require data migration - Mongoose handles validation
  }

  const fromDefault = JSON.stringify(from.default);
  const toDefault = JSON.stringify(to.default);

  if (fromDefault !== toDefault) {
    changes.push(`default: ${fromDefault} → ${toDefault}`);
    // Default changes don't require data migration - only affect new documents
  }

  const fromEnum = JSON.stringify(from.enum?.sort());
  const toEnum = JSON.stringify(to.enum?.sort());

  if (fromEnum !== toEnum) {
    changes.push(`enum: ${fromEnum} → ${toEnum}`);
    // Enum changes don't require data migration - Mongoose handles validation
  }

  return {
    changed: changes.length > 0,
    changes,
    significantChange,
  };
}

/**
 * Enhanced field diffing with cleaner output and smarter filtering
 */
function diffFieldsRefined(
  collectionName: string,
  dbFields: { [name: string]: FieldDefinition }, // Database snapshot (comparison only)
  codeFields: { [name: string]: FieldDefinition }, // Code snapshot (source of truth)
  isDbCollectionEmpty = false
): { up: MigrationCommand[]; down: MigrationCommand[]; warnings: string[] } {
  const up: MigrationCommand[] = [];
  const down: MigrationCommand[] = [];
  const warnings: string[] = [];

  if (isDbCollectionEmpty) {
    return { up, down, warnings };
  }

  // Filter out Mongoose-managed fields from both snapshots
  const filteredDbFields = Object.fromEntries(
    Object.entries(dbFields).filter(
      ([fieldName]) => !MONGOOSE_MANAGED_FIELDS.has(fieldName)
    )
  );
  const filteredCodeFields = Object.fromEntries(
    Object.entries(codeFields).filter(
      ([fieldName]) => !MONGOOSE_MANAGED_FIELDS.has(fieldName)
    )
  );

  const dbFieldNames = new Set(Object.keys(filteredDbFields));
  const codeFieldNames = new Set(Object.keys(filteredCodeFields));

  // NEW FIELDS: In code but not in database
  for (const fieldName of codeFieldNames) {
    if (!dbFieldNames.has(fieldName)) {
      const codeField = filteredCodeFields[fieldName];

      // Smart default value handling
      let migrationValue: any = null;

      let description = `Add field '${fieldName}' to collection '${collectionName}'`;

      if (codeField.default !== undefined) {
        // Use the default value from code definition
        migrationValue = codeField.default;

        description += ` with default value`;
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

        description += ` with generated default (required field)`;

        warnings.push(
          `⚠️  Field '${fieldName}' in '${collectionName}' is required but has no default. Using type-based default: ${JSON.stringify(
            migrationValue
          )}`
        );
      } else {
        // Field is optional or nullable, use null
        migrationValue = null;
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

  // REMOVED FIELDS: In database but not in code (excluding Mongoose managed fields)
  for (const fieldName of dbFieldNames) {
    if (!codeFieldNames.has(fieldName)) {
      const dbField = filteredDbFields[fieldName];

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
  // Only generate migrations for truly significant changes
  for (const fieldName of codeFieldNames) {
    if (dbFieldNames.has(fieldName)) {
      const codeField = filteredCodeFields[fieldName];
      const dbField = filteredDbFields[fieldName];

      const comparison = compareFields(dbField, codeField, fieldName);

      if (comparison.changed) {
        // Only generate migrations for significant changes that actually require data transformation
        if (comparison.significantChange) {
          warnings.push(
            `⚠️  Significant type change for '${fieldName}' in '${collectionName}': ${dbField.type} → ${codeField.type}. Review if data migration is needed.`
          );

          up.push({
            command: `// TODO: Review type change for '${fieldName}': ${dbField.type} → ${codeField.type}`,
            description: `Field '${fieldName}' type changed significantly - review data compatibility`,
            safetyLevel: "warning",
            metadata: {
              fieldPath: fieldName,
              changes: comparison.changes,
              fromField: dbField,
              toField: codeField,
              reason: "significant_type_change",
            },
          });

          down.push({
            command: `// TODO: Revert type change for '${fieldName}': ${codeField.type} → ${dbField.type}`,
            description: `Revert significant type change for field '${fieldName}'`,
            safetyLevel: "warning",
            metadata: {
              fieldPath: fieldName,
              fieldDefinition: dbField,
              reason: "revert_significant_change",
            },
          });
        } else {
          // For non-significant changes, just log them (no migration needed)
          // const isAutoGenerated = AUTO_GENERATED_FIELDS.has(fieldName);
          // if (!isAutoGenerated) {
          //   console.log(
          //     `     ℹ️  Non-significant change - Mongoose will handle validation`
          //   );
          // } else {
          //   console.log(
          //     `     ℹ️  Auto-generated field type normalized - no action needed`
          //   );
          // }
          // up.push({
          //   command: `// Schema definition updated: ${fieldName} (${comparison.changes.join(
          //     ", "
          //   )})`,
          //   description: `Field '${fieldName}' schema updated${
          //     isAutoGenerated ? " (auto-generated field)" : ""
          //   } - no data migration needed`,
          //   safetyLevel: "safe",
          //   metadata: {
          //     fieldPath: fieldName,
          //     changes: comparison.changes,
          //     fromField: dbField,
          //     toField: codeField,
          //     reason: isAutoGenerated
          //       ? "auto_generated_field_normalized"
          //       : "schema_definition_only",
          //   },
          // });
        }
      }
    }
  }

  return { up, down, warnings };
}

// Keep existing collection diffing but remove validator concerns
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
        `⚠️  Will drop collection '${collectionName}' - ensure it's backed up`
      );
    }
  }

  return { up, down, warnings };
}

// Enhanced index signature that accounts for all relevant properties
function indexSignature(index: IndexDefinition): string {
  const normalized = {
    fields: index.fields.map(f => ({ field: f.field, direction: f.direction })),
    unique: index.unique || false,
    sparse: index.sparse || false,
    expireAfterSeconds: index.expireAfterSeconds,
    partialFilterExpression: index.partialFilterExpression,
    text: index.text || false,
  };

  return JSON.stringify(normalized, Object.keys(normalized).sort());
}

// Simplified index diffing (keep existing logic but make it cleaner)
function diffIndexes(
  collectionName: string,
  fromIndexes: IndexDefinition[],
  toIndexes: IndexDefinition[]
): { up: MigrationCommand[]; down: MigrationCommand[]; warnings: string[] } {
  const up: MigrationCommand[] = [];
  const down: MigrationCommand[] = [];
  const warnings: string[] = [];

  // Create signature maps for easier comparison
  const fromSignatureMap = new Map<string, IndexDefinition>();
  const toSignatureMap = new Map<string, IndexDefinition>();

  fromIndexes.forEach(index => {
    fromSignatureMap.set(indexSignature(index), index);
  });

  toIndexes.forEach(index => {
    toSignatureMap.set(indexSignature(index), index);
  });

  const fromSignatures = Array.from(fromSignatureMap.keys());
  const toSignatures = Array.from(toSignatureMap.keys());

  // Added indexes (in code but not in database)
  for (const signature of toSignatures) {
    if (!fromSignatures.includes(signature)) {
      const toIndex = toSignatureMap.get(signature)!;
      const fields = toIndex.fields
        .map(f => `${f.field}: ${f.direction}`)
        .join(", ");

      let description = `Create index on ${fields} for collection '${collectionName}'`;

      // Add TTL info to description
      if (toIndex.expireAfterSeconds !== undefined) {
        description += ` (TTL: ${toIndex.expireAfterSeconds}s)`;
      }

      up.push({
        command: generateIndexCommand(collectionName, toIndex),
        description,
        safetyLevel: "safe",
        metadata: {
          index: toIndex,
          indexType:
            toIndex.expireAfterSeconds !== undefined ? "ttl" : "regular",
        },
      });

      const indexName = generateIndexName(toIndex);
      down.push({
        command: `db.collection("${collectionName}").dropIndex("${indexName}")`,
        description: `Drop index '${indexName}' from collection '${collectionName}'`,
        safetyLevel: "warning",
        metadata: { indexName, index: toIndex },
      });
    }
  }

  // Removed indexes (in database but not in code)
  for (const signature of fromSignatures) {
    if (!toSignatures.includes(signature)) {
      const fromIndex = fromSignatureMap.get(signature)!;
      const indexName = generateIndexName(fromIndex);

      let description = `Drop index '${indexName}' from collection '${collectionName}'`;

      // Add TTL info to description
      if (fromIndex.expireAfterSeconds !== undefined) {
        description += ` (TTL index)`;
        warnings.push(
          `⚠️  TTL index '${indexName}' on '${collectionName}' will be dropped. Ensure this is intended.`
        );
      }

      up.push({
        command: `db.collection("${collectionName}").dropIndex("${indexName}")`,
        description,
        safetyLevel: "warning",
        metadata: {
          indexName,
          index: fromIndex,
          indexType:
            fromIndex.expireAfterSeconds !== undefined ? "ttl" : "regular",
        },
      });

      down.push({
        command: generateIndexCommand(collectionName, fromIndex),
        description: `Recreate index '${indexName}' on collection '${collectionName}'`,
        safetyLevel: "safe",
        metadata: { index: fromIndex },
      });
    }
  }

  return { up, down, warnings };
}

function generateIndexName(index: IndexDefinition): string {
  if (index.name) {
    return index.name;
  }

  // Generate name from fields
  const fieldNames = index.fields
    .map(f => {
      if (f.direction === 1) {
        return f.field;
      } else {
        return `${f.field}_-1`;
      }
    })
    .join("_");

  // Add suffix for special index types
  if (index.expireAfterSeconds !== undefined) {
    return `${fieldNames}_ttl`;
  }
  if (index.text) {
    return `${fieldNames}_text`;
  }
  if (index.unique) {
    return `${fieldNames}_unique`;
  }

  return fieldNames;
}

function generateIndexCommand(
  collectionName: string,
  index: IndexDefinition
): string {
  const fields = index.fields
    .map(f => `"${f.field}": ${f.direction}`)
    .join(", ");

  const options: string[] = [];

  if (index.unique) options.push("unique: true");
  if (index.sparse) options.push("sparse: true");
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
  if (index.name) {
    options.push(`name: "${index.name}"`);
  }

  const optionsStr = options.length > 0 ? `, { ${options.join(", ")} }` : "";

  return `db.collection("${collectionName}").createIndex({ ${fields} }${optionsStr})`;
}

function injectSessionIntoCommand(command: string): string {
  if (command.trim().startsWith("//")) {
    return command;
  }

  // Handle different MongoDB operations with proper session injection
  if (command.includes("db.collection(")) {
    // Extract collection name and method
    const collectionMatch = command.match(
      /db\.collection\("([^"]+)"\)\.(\w+)\(/
    );

    if (!collectionMatch) {
      return command;
    }

    const [, _, method] = collectionMatch;

    switch (method) {
      case "drop": {
        // Drop operations cannot run in transactions and are irreversible
        // Require manual execution to prevent accidental data loss
        return command.replace(
          /db\.collection\("([^"]+)"\)\.drop\(\)/,
          `// WARNING: Execute manually outside or delete from your MongoDB Database: db.collection("$1").drop()
    // This operation is irreversible and cannot run within a transaction`
        );
      }

      case "createIndex": {
        // No need for this call because Mongoose does this under the hood already

        // // Index creation: add session to options object or create one
        // const lastParenIndex = command.lastIndexOf(")");
        // if (lastParenIndex > -1) {
        //   const beforeLastParen = command.substring(0, lastParenIndex);
        //   const afterLastParen = command.substring(lastParenIndex);

        //   // Check if there's already an options object
        //   const optionsMatch = beforeLastParen.match(/,\s*\{([^}]*)\}\s*$/);
        //   if (optionsMatch) {
        //     // Add session to existing options
        //     return beforeLastParen.replace(
        //       /,\s*\{([^}]*)\}\s*$/,
        //       ', { $1, session }'
        //     ) + afterLastParen;
        //   } else {
        //     // Add session as new options object
        //     return beforeLastParen + ', { session }' + afterLastParen;
        //   }
        // }
        break;
      }

      case "dropIndex": {
        // dropIndex cannot run in transactions - require manual execution
        return command.replace(
          /db\.collection\("([^"]+)"\)\.dropIndex\("([^"]+)"\)/,
          `// WARNING: Execute manually outside or delete from your MongoDB Database: db.collection("$1").dropIndex("$2")
    // Index drops cannot run within a transaction`
        );
      }

      case "updateMany":
      case "updateOne":
      case "deleteMany":
      case "deleteOne":
      case "replaceOne":
      case "findOneAndUpdate":
      case "findOneAndReplace":
      case "findOneAndDelete": {
        // Update operations: session should be in options (third parameter)
        const updateMatch = command.match(
          /^(.+\.(?:updateMany|updateOne|deleteMany|deleteOne|replaceOne|findOneAndUpdate|findOneAndReplace|findOneAndDelete)\([^,]+,\s*[^,]+)(\s*\))(.*)$/
        );

        if (updateMatch) {
          const [, beforeOptions, closeParen, after] = updateMatch;

          return `${beforeOptions}, { session }${closeParen}${after}`;
        }

        break;
      }

      case "insertOne":
      case "insertMany": {
        // Insert operations: session goes in options (second parameter)
        const insertMatch = command.match(
          /^(.+\.(?:insertOne|insertMany)\([^)]+)(\))(.*)$/
        );

        if (insertMatch) {
          const [, beforeClose, closeParen, after] = insertMatch;
          return `${beforeClose}, { session }${closeParen}${after}`;
        }

        break;
      }
    }
  }

  // Handle db.createCollection separately
  if (command.includes("db.createCollection(")) {
    const createMatch = command.match(
      /^(.+db\.createCollection\("[^"]+")(\))(.*)$/
    );

    if (createMatch) {
      const [, beforeClose, closeParen, after] = createMatch;

      return `${beforeClose}, { session }${closeParen}${after}`;
    }
  }

  return command;
}

/**
 * Refined diff function with cleaner output and better filtering
 */
export function diffSnapshots(
  dbSnapshot: Snapshot, // Database state (for comparison)
  codeSnapshot: Snapshot // Code state (source of truth)
): DiffResult {
  console.log("\n[Mongeese] 🔄 Starting diff analysis...");
  // console.log(
  //   `   📊 Database snapshot: ${
  //     Object.keys(dbSnapshot.collections).length
  //   } collections`
  // );
  // console.log(
  //   `   💻 Code snapshot: ${
  //     Object.keys(codeSnapshot.collections).length
  //   } collections`
  // );

  const normalizedDb = normalizeSnapshot(dbSnapshot);
  const normalizedCode = normalizeSnapshot(codeSnapshot);

  const allUp: MigrationCommand[] = [];
  const allDown: MigrationCommand[] = [];
  const allWarnings: string[] = [];

  const metadata: DiffResult["metadata"] = {
    collections: { added: [], removed: [], modified: [] },
    fields: { added: [], removed: [], modified: [], renamed: [] },
    indexes: { added: [], removed: [], modified: [] },
    validators: { added: [], removed: [], modified: [] }, // Keep for compatibility but won't populate
  };

  // Diff collections
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

  // Track collections that actually have changes (not just exist in both)
  const modifiedCollections: string[] = [];

  // Diff fields and indexes for each collection using refined approach
  for (const collectionName of codeCollectionNames) {
    const codeCollection = normalizedCode.collections[collectionName];
    const dbCollection = normalizedDb.collections[collectionName];

    if (dbCollection) {
      // Collection exists in both - check if there are actual changes
      let hasFieldChanges = false;

      let hasIndexChanges = false;

      // Diff the fields with refined logic
      const fieldDiff = diffFieldsRefined(
        collectionName,
        dbCollection.fields, // Database state
        codeCollection.fields, // Code state (truth)
        dbCollection.isEmpty
      );

      if (fieldDiff.up.length > 0 || fieldDiff.down.length > 0) {
        hasFieldChanges = true;
        allUp.push(...fieldDiff.up);
        allDown.push(...fieldDiff.down);
        allWarnings.push(...fieldDiff.warnings);
      }

      // Diff indexes
      const indexDiff = diffIndexes(
        collectionName,
        dbCollection.indexes || [],
        codeCollection.indexes || []
      );

      if (indexDiff.up.length > 0 || indexDiff.down.length > 0) {
        hasIndexChanges = true;
        allUp.push(...indexDiff.up);
        allDown.push(...indexDiff.down);
        allWarnings.push(...indexDiff.warnings);
      }

      // Only mark as modified if there are actual changes
      if (hasFieldChanges || hasIndexChanges) {
        modifiedCollections.push(collectionName);
      }
    } else {
      // New collection - all fields are new
      console.log(
        `   🆕 New collection '${collectionName}' with ${
          Object.keys(codeCollection.fields).length
        } fields`
      );
    }
  }

  metadata.collections.modified = modifiedCollections;

  // Add session support to all commands
  const up = allUp.map(cmd => ({
    ...cmd,
    command: injectSessionIntoCommand(cmd.command),
  }));

  const down = allDown.map(cmd => ({
    ...cmd,
    command: injectSessionIntoCommand(cmd.command),
  }));

  // Filter out non-actionable commands for cleaner output
  // const actionableUps = up.filter(
  //   cmd =>
  //     (!cmd.command.includes("// Schema definition updated") &&
  //       !cmd.command.startsWith("// TODO: Review type change")) ||
  //     cmd.safetyLevel === "warning"
  // );

  // console.log(
  //   `[Mongeese] ✅ Refined diff completed: ${
  //     actionableUps.length
  //   } actionable migrations, ${up.length - actionableUps.length} schema updates`
  // );
  console.log(`[Mongeese] ⚠️  Generated ${allWarnings.length} warnings`);

  return { up, down, warnings: allWarnings, metadata };
}
