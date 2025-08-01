import { FieldMap } from "../interfaces/snapshot";

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

    if (
      obj[key] !== null &&
      typeof obj[key] === "object" &&
      !Array.isArray(obj[key])
    ) {
      flatten(obj[key], path, result);
    } else {
      result[path] = "Mixed"; // Default type for now
    }
  }
  return result;
}
