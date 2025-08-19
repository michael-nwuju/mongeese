import { FieldMap } from "../types";
import { detectFieldType } from "./detect-field-type";

export function flatten(
  obj: any,
  prefix = "",
  result: FieldMap = {}
): FieldMap {
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      continue;
    }

    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !value._bsontype && // Skip BSON types like ObjectID
      !Buffer.isBuffer(value)
    ) {
      // Recursively flatten nested objects
      flatten(value, path, result);
    } else {
      // Use proper type detection instead of always assigning "Mixed"
      const detectedType = detectFieldType(value);
      result[path] = detectedType;
    }
  }
  return result;
}
