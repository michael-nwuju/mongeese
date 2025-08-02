// Field summary statistics for efficient processing
export interface FieldStats {
  totalDocuments: number; // Total documents sampled

  presentCount: number; // Documents where field exists (even if null/undefined)

  nullCount: number; // Documents where field is explicitly null

  undefinedCount: number; // Documents where field is explicitly undefined

  typeSet: Set<string>; // Types of non-nullish values

  valueSet: Set<string>; // For detecting defaults

  stringValues: Set<string>; // For enum detection
}

// Helper function to determine field type from sample data
export function detectFieldType(value: any): string {
  if (value === null) {
    return "Null";
  }

  if (value === undefined) {
    return "Undefined";
  }

  const type = typeof value;

  switch (type) {
    case "string": {
      return "String";
    }

    case "boolean": {
      return "Boolean";
    }

    case "number": {
      return "Number";
    }

    case "object": {
      if (Array.isArray(value)) {
        return "Array";
      }

      if (value instanceof Date) {
        return "Date";
      }

      if (value._bsontype === "ObjectID" || value.$oid) {
        return "ObjectId";
      }

      return "Object";
    }

    default: {
      return "Mixed";
    }
  }
}

// Initialize field stats
export function createFieldStats(): FieldStats {
  return {
    totalDocuments: 0,
    presentCount: 0,
    nullCount: 0,
    undefinedCount: 0,
    typeSet: new Set<string>(),
    valueSet: new Set<string>(),
    stringValues: new Set<string>(),
  };
}

// Update field stats with a single value
export function updateFieldStats(
  stats: FieldStats,
  value: any,
  fieldExists: boolean
): void {
  stats.totalDocuments++;

  if (!fieldExists) {
    // Field is missing entirely - don't increment presentCount
    return;
  }

  // Field exists in this document
  stats.presentCount++;

  if (value === null) {
    stats.nullCount++;
    stats.typeSet.add("Null");
    return;
  }

  if (value === undefined) {
    stats.undefinedCount++;
    stats.typeSet.add("Undefined");
    return;
  }

  // Field has a non-nullish value
  const type = detectFieldType(value);
  stats.typeSet.add(type);

  // Track value for default detection
  const valueStr = JSON.stringify(value);
  stats.valueSet.add(valueStr);

  // Track string values for enum detection
  if (typeof value === "string") {
    stats.stringValues.add(value);
  }
}

// Infer field type from stats
export function inferFieldType(stats: FieldStats): string {
  const types = Array.from(stats.typeSet);

  // Remove null/undefined from type consideration
  const nonNullTypes = types.filter(t => t !== "Null" && t !== "Undefined");

  if (nonNullTypes.length === 0) {
    return "Unknown"; // Only null/undefined values or missing fields
  }

  if (nonNullTypes.length === 1) {
    return nonNullTypes[0];
  }

  // Multiple types detected
  return "Mixed";
}

// Infer if field is required from stats
export function inferRequired(stats: FieldStats): boolean {
  // Required only if field is present in 100% of sampled documents
  return stats.presentCount === stats.totalDocuments;
}

// Infer if field is nullable from stats
export function inferNullable(stats: FieldStats): boolean {
  // Nullable if any null or undefined values were seen in present fields
  return stats.nullCount > 0 || stats.undefinedCount > 0;
}

// Infer default value from stats
export function inferDefault(stats: FieldStats): any {
  if (stats.valueSet.size === 1) {
    const valueStr = Array.from(stats.valueSet)[0];
    return JSON.parse(valueStr);
  }
  return undefined;
}

// #TODO: Not strong enough, needs more work
// Infer enum values from stats
export function inferEnum(stats: FieldStats): string[] | undefined {
  if (stats.stringValues.size === 0) {
    return undefined;
  }

  const uniqueValues = Array.from(stats.stringValues);
  if (uniqueValues.length <= 10 && uniqueValues.length > 1) {
    return uniqueValues.sort();
  }

  return undefined;
}
