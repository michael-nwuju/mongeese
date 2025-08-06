import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import {
  DiffResult,
  GenerateMigrationOptions,
  MigrationCommand,
} from "../types";
import detectProjectType from "../utilities/detect-project-type";

const PROJECT_TYPE = detectProjectType();

const EXTENSION = PROJECT_TYPE === "typescript" ? "ts" : "js";

/**
 * Generate timestamp in format YYYYMMDD_HHMMSS
 */
export function generateTimestamp(): string {
  const now = new Date();

  const year = now.getFullYear();

  const month = String(now.getMonth() + 1).padStart(2, "0");

  const day = String(now.getDate()).padStart(2, "0");

  const hours = String(now.getHours()).padStart(2, "0");

  const minutes = String(now.getMinutes()).padStart(2, "0");

  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * Sanitize migration name for filename
 */
export function sanitizeMigrationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Format migration commands for the template
 */
export function formatMigrationCommands(commands: MigrationCommand[]): string {
  if (commands.length === 0) {
    return "    // No changes detected";
  }

  return commands
    .map(cmd => {
      const lines = [];

      // Add description as comment
      if (cmd.description) {
        lines.push(`    // ${cmd.description}`);
      }

      // Add safety level warning if needed
      if (cmd.safetyLevel === "dangerous") {
        lines.push(`    // ⚠️  DANGEROUS: This operation may cause data loss`);
      } else if (cmd.safetyLevel === "warning") {
        lines.push(`    // ⚠️  WARNING: Review this operation carefully`);
      }

      // Add the actual command
      if (cmd.command.startsWith("//")) {
        // Comment-only command
        lines.push(`    ${cmd.command}`);
      } else if (
        cmd.command.includes("await ") ||
        cmd.command.includes("session.")
      ) {
        // Async command
        lines.push(`    await ${cmd.command.replace(/^await /, "")};`);
      } else {
        // Regular command
        lines.push(`    ${cmd.command};`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Format warnings for the template
 */
export function formatWarnings(warnings: string[]): string {
  if (warnings.length === 0) {
    return " * No warnings";
  }

  return warnings.map(warning => ` * ${warning}`).join("\n");
}

/**
 * Format metadata summary for the template
 */
export function formatMetadataSummary(
  metadata: DiffResult["metadata"]
): string {
  const summary = [];

  if (metadata.collections.added.length > 0) {
    summary.push(`Collections added: ${metadata.collections.added.join(", ")}`);
  }

  if (metadata.collections.removed.length > 0) {
    summary.push(
      `Collections removed: ${metadata.collections.removed.join(", ")}`
    );
  }

  if (metadata.collections.modified.length > 0) {
    summary.push(
      `Collections modified: ${metadata.collections.modified.join(", ")}`
    );
  }

  if (metadata.fields.added.length > 0) {
    summary.push(`Fields added: ${metadata.fields.added.length}`);
  }

  if (metadata.fields.removed.length > 0) {
    summary.push(`Fields removed: ${metadata.fields.removed.length}`);
  }

  if (metadata.fields.renamed.length > 0) {
    summary.push(`Fields renamed: ${metadata.fields.renamed.length}`);
  }

  if (metadata.indexes.added.length > 0) {
    summary.push(`Indexes added: ${metadata.indexes.added.length}`);
  }

  if (metadata.indexes.removed.length > 0) {
    summary.push(`Indexes removed: ${metadata.indexes.removed.length}`);
  }

  return summary.length > 0
    ? summary.map(s => ` * ${s}`).join("\n")
    : " * No changes detected";
}

/**
 * Generate TypeScript migration template
 */
export function generateTSTemplate(
  migrationName: string,
  diffResult: DiffResult
): string {
  return `import { Db } from "mongodb";

/**
 * Migration: ${migrationName}
 * Generated: ${new Date().toISOString()}
 * 
 * Summary:
${formatMetadataSummary(diffResult.metadata)}
 * 
 * Warnings:
${formatWarnings(diffResult.warnings)}
 */
export class ${migrationName} {
  /**
   * Apply the migration (up)
   */
  public async up(db: Db): Promise<void> {
${formatMigrationCommands(diffResult.up)}
  }

  /**
   * Revert the migration (down)
   */
  public async down(db: Db): Promise<void> {
${formatMigrationCommands(diffResult.down)}
  }
}
`;
}

/**
 * Generate JavaScript migration template
 */
export function generateJSTemplate(
  migrationName: string,
  diffResult: DiffResult
): string {
  return `/**
 * Migration: ${migrationName}
 * Generated: ${new Date().toISOString()}
 * 
 * Summary:
${formatMetadataSummary(diffResult.metadata)}
 * 
 * Warnings:
${formatWarnings(diffResult.warnings)}
 */
class ${migrationName} {
  /**
   * Apply the migration (up)
   */
  async up(db) {
${formatMigrationCommands(diffResult.up)}
  }

  /**
   * Revert the migration (down)
   */
  async down(db) {
${formatMigrationCommands(diffResult.down)}
  }
}

module.exports = { ${migrationName} };
`;
}

/**
 * Generate migration file content
 */
export function generateMigrationContent(
  migrationName: string,
  diffResult: DiffResult
): string {
  return PROJECT_TYPE === "typescript"
    ? generateTSTemplate(migrationName, diffResult)
    : generateJSTemplate(migrationName, diffResult);
}

/**
 * Ensure migrations directory exists
 */
export async function ensureMigrationsDirectory(): Promise<string> {
  const migrationsDir = path.join(process.cwd(), "migrations");

  await fs.ensureDir(migrationsDir);

  return migrationsDir;
}

/**
 * Generate migration preview file
 */
export async function generateMigrationPreview(
  diffResult: DiffResult,
  options: GenerateMigrationOptions = {}
): Promise<void> {
  // Check if there are any changes to migrate
  const hasChanges = diffResult.up.length > 0 || diffResult.down.length > 0;

  if (!hasChanges) {
    return console.log(
      chalk.yellow(
        "No schema changes detected. Use --force to generate empty migration."
      )
    );
  }

  // Generate migration name
  const timestamp = generateTimestamp();

  const baseName = options.name
    ? sanitizeMigrationName(options.name)
    : "schema_migration";

  const migrationName = `Migration${timestamp}_${baseName}`;
  const filename = `${timestamp}_${baseName}.${EXTENSION}`;

  // Ensure migrations directory exists
  const migrationsDir = await ensureMigrationsDirectory();

  const filepath = path.join(migrationsDir, filename);

  // Check if file already exists
  if (await fs.pathExists(filepath)) {
    throw new Error(`Migration file already exists: ${filename}.`);
  }

  // Generate migration content
  const content = generateMigrationContent(migrationName, diffResult);

  await fs.writeFile(filepath, content, "utf8");
}
