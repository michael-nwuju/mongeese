import { FieldStats } from "../types";

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
      // Check if it's an integer or float
      return Number.isInteger(value) ? "Number" : "Number";
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

      // Check for other BSON types
      if (Buffer.isBuffer(value)) {
        return "Buffer";
      }

      if (value._bsontype === "Decimal128") {
        return "Decimal128";
      }

      if (value._bsontype === "Long") {
        return "Long";
      }

      if (value._bsontype === "BinData") {
        return "Binary";
      }

      return "Object";
    }

    case "bigint": {
      return "BigInt";
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

  // Track value for default detection (but be careful with large objects)
  try {
    const valueStr = JSON.stringify(value);
    // Only store small values to avoid memory issues
    if (valueStr.length < 1000) {
      stats.valueSet.add(valueStr);
    }
  } catch (error) {
    // Ignore circular references or other serialization issues
  }
}

// Infer field type from stats
export function inferFieldType(stats: FieldStats): string {
  const types = Array.from(stats.typeSet);

  // Remove null/undefined from type consideration
  const nonNullTypes = types.filter(t => t !== "Null" && t !== "Undefined");

  if (nonNullTypes.length === 0) {
    return "Mixed"; // Only null/undefined values or missing fields
  }

  if (nonNullTypes.length === 1) {
    return nonNullTypes[0];
  }

  // Handle common type combinations
  if (nonNullTypes.length === 2) {
    const typeSet = new Set(nonNullTypes);

    // Number variations should be treated as Number
    if (
      typeSet.has("Number") &&
      (typeSet.has("Long") || typeSet.has("Decimal128"))
    ) {
      return "Number";
    }

    // String variations
    if (typeSet.has("String") && typeSet.has("ObjectId")) {
      return "Mixed"; // Could be either string or ObjectId
    }
  }

  // Multiple types detected - this is a mixed field
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
  // Only infer default if all present values are the same
  if (stats.valueSet.size === 1 && stats.presentCount > 1) {
    const valueStr = Array.from(stats.valueSet)[0];
    try {
      return JSON.parse(valueStr);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Remove inferEnum function entirely - enums should be inferred from code, not database
// Database sampling cannot reliably determine if a string field should be an enum
// This should be handled at the code analysis level, not database inspection level
