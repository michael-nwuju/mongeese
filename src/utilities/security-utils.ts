import * as path from "path";
import * as fs from "fs-extra";

export function validateIdentifier(
  name: string,
  type: "collection" | "field" | "migration"
): string {
  if (!name || typeof name !== "string") {
    throw new Error(`${type} name must be a non-empty string`);
  }

  // Allow alphanumeric, underscore, and hyphen for migration names
  const regex = type === "migration" ? /^[a-zA-Z0-9_-]+$/ : /^[a-zA-Z0-9_]+$/;

  if (!regex.test(name)) {
    throw new Error(
      `${type} name "${name}" contains invalid characters. ` +
        `Only letters, numbers, ${
          type === "migration" ? "underscores, and hyphens" : "and underscores"
        } are allowed.`
    );
  }

  //   if (name.length > 100) {
  //     throw new Error(`${type} name "${name}" is too long (max 100 characters)`);
  //   }

  return name;
}

export function safeResolve(basePath: string, userPath: string): string {
  const resolved = path.resolve(basePath, userPath);
  const normalized = path.normalize(resolved);

  // Ensure the resolved path is within the base path
  if (!normalized.startsWith(path.resolve(basePath))) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }

  return normalized;
}

export function safeJsonParse(
  content: string,
  maxSize: number = 10 * 1024 * 1024
): any {
  if (content.length > maxSize) {
    throw new Error(
      `JSON content too large (${content.length} bytes, max ${maxSize})`
    );
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Invalid JSON: ${error instanceof Error ? error.message : "Parse error"}`
    );
  }
}

export function maskSensitiveInfo(message: string): string {
  return (
    message
      // Mask MongoDB URIs
      .replace(/mongodb(\+srv)?:\/\/[^:]+:[^@]+@/g, "mongodb$1://***:***@")
      // Mask any other potential credentials
      .replace(
        /([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]\s*['"]([^'"]{8,})['"](?=.*(?:password|token|key|secret|auth))/gi,
        '$1: "***"'
      )
  );
}

export async function secureWriteFile(
  filePath: string,
  content: string,
  options: { mode?: number } = {}
): Promise<void> {
  const mode = options.mode ?? 0o600; // Default to owner read/write only

  try {
    await fs.writeFile(filePath, content, { mode });
  } catch (error) {
    throw new Error(
      `Failed to write file ${path.basename(filePath)}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
