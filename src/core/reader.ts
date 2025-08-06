import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { Db } from "mongodb";

export interface MigrationFile {
  filename: string;
  filepath: string;
  timestamp: string;
  name: string;
  className: string;
  instance?: MigrationInstance;
}

export interface MigrationInstance {
  up(db: Db): Promise<void>;
  down(db: Db): Promise<void>;
}

/**
 * Parse migration filename to extract timestamp and name
 */
function parseMigrationFilename(filename: string): {
  timestamp: string;
  name: string;
  className: string;
} | null {
  // Expected format: YYYYMMDD_HHMMSS_migration_name.ts/js
  const match = filename.match(/^(\d{8}_\d{6})_(.+)\.(ts|js)$/);

  if (!match) {
    return null;
  }

  const [, timestamp, name] = match;

  // Generate class name: Migration20250804_120000_add_user_field
  const className = `Migration${timestamp}_${name}`;

  return {
    timestamp,
    name,
    className,
  };
}

/**
 * Get all migration files from the migrations directory
 */
export async function getMigrationFiles(): Promise<MigrationFile[]> {
  const migrationsDir = path.join(process.cwd(), "migrations");

  if (!(await fs.pathExists(migrationsDir))) {
    return [];
  }

  const files = await fs.readdir(migrationsDir);
  const migrationFiles: MigrationFile[] = [];

  for (const filename of files) {
    const parsed = parseMigrationFilename(filename);

    if (parsed) {
      const filepath = path.join(migrationsDir, filename);

      migrationFiles.push({
        filename,
        filepath,
        timestamp: parsed.timestamp,
        name: parsed.name,
        className: parsed.className,
      });
    }
  }

  // Sort by timestamp (oldest first)
  return migrationFiles.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Load a migration file and return its instance
 */
export async function loadMigrationFile(
  migrationFile: MigrationFile
): Promise<MigrationFile> {
  try {
    // Clear require cache to ensure fresh load
    const absolutePath = path.resolve(migrationFile.filepath);
    delete require.cache[absolutePath];

    // Import the migration
    const migrationModule = require(absolutePath);

    // Handle different export formats
    let MigrationClass;

    if (migrationModule[migrationFile.className]) {
      // Named export: export class Migration20250804_120000_add_user_field
      MigrationClass = migrationModule[migrationFile.className];
    } else if (migrationModule.default) {
      // Default export: export default class Migration...
      MigrationClass = migrationModule.default;
    } else {
      // Look for any class export
      const classNames = Object.keys(migrationModule).filter(
        key =>
          typeof migrationModule[key] === "function" &&
          key.startsWith("Migration")
      );

      if (classNames.length === 1) {
        MigrationClass = migrationModule[classNames[0]];
      } else {
        throw new Error(
          `Could not find migration class in ${migrationFile.filename}`
        );
      }
    }

    // Validate the migration class
    const instance = new MigrationClass();

    if (typeof instance.up !== "function") {
      throw new Error(
        `Migration ${migrationFile.filename} missing 'up' method`
      );
    }

    if (typeof instance.down !== "function") {
      throw new Error(
        `Migration ${migrationFile.filename} missing 'down' method`
      );
    }

    return {
      ...migrationFile,
      instance,
    };
  } catch (error) {
    console.error(
      chalk.red(`❌ Failed to load migration ${migrationFile.filename}:`),
      error
    );
    throw error;
  }
}

/**
 * Validate migration file syntax without executing it
 */
export async function validateMigrationFile(
  migrationFile: MigrationFile
): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Read the file content
    const content = await fs.readFile(migrationFile.filepath, "utf8");

    // Basic syntax checks
    if (!content.includes("up(") && !content.includes("up (")) {
      errors.push("Missing up() method");
    }

    if (!content.includes("down(") && !content.includes("down (")) {
      errors.push("Missing down() method");
    }

    // Check for potentially dangerous operations
    const dangerousPatterns = [
      { pattern: /\.drop\(\)/g, message: "Collection drop detected" },
      {
        pattern: /\.deleteMany\(\{\}\)/g,
        message: "Delete all documents detected",
      },
      { pattern: /\$unset/g, message: "Field removal detected" },
      { pattern: /dropIndex/g, message: "Index drop detected" },
    ];

    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(content)) {
        warnings.push(message);
      }
    }

    // Try to load the migration to check for syntax errors
    try {
      await loadMigrationFile(migrationFile);
    } catch (loadError) {
      errors.push(
        `Load error: ${
          loadError instanceof Error ? loadError.message : String(loadError)
        }`
      );
    }
  } catch (error) {
    errors.push(
      `File read error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get pending migrations (not yet applied)
 */
export async function getPendingMigrations(
  appliedMigrations: string[] = []
): Promise<MigrationFile[]> {
  const allMigrations = await getMigrationFiles();

  return allMigrations.filter(
    migration => !appliedMigrations.includes(migration.filename)
  );
}

/**
 * Format migration timestamp for display
 */
export function formatMigrationTimestamp(timestamp: string): string {
  // Convert YYYYMMDD_HHMMSS to readable format
  const match = timestamp.match(
    /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/
  );

  if (!match) {
    return timestamp;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  const date = new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
    parseInt(seconds)
  );

  return date.toLocaleString();
}

// /**
//  * Show migration file summary
//  */
// export function displayMigrationSummary(migrations: MigrationFile[]): void {
//   if (migrations.length === 0) {
//     console.log(chalk.yellow("No migrations found."));
//     return;
//   }

//   console.log(chalk.cyan(`\n📋 Found ${migrations.length} migration(s):\n`));

//   const maxNameLength = Math.max(...migrations.map(m => m.name.length));

//   for (const migration of migrations) {
//     const paddedName = migration.name.padEnd(maxNameLength);
//     const formattedTime = formatMigrationTimestamp(migration.timestamp);

//     console.log(
//       `  ${chalk.green("✓")} ${chalk.bold(paddedName)} ${chalk.gray(
//         `(${formattedTime})`
//       )}`
//     );
//   }

//   console.log();
// }

// /**
//  * Validate all migration files
//  */
// export async function validateAllMigrations(): Promise<{
//   valid: MigrationFile[];
//   invalid: Array<MigrationFile & { errors: string[]; warnings: string[] }>;
// }> {
//   const migrations = await getMigrationFiles();
//   const valid: MigrationFile[] = [];
//   const invalid: Array<
//     MigrationFile & { errors: string[]; warnings: string[] }
//   > = [];

//   for (const migration of migrations) {
//     const validation = await validateMigrationFile(migration);

//     if (validation.valid) {
//       valid.push(migration);
//     } else {
//       invalid.push({
//         ...migration,
//         errors: validation.errors,
//         warnings: validation.warnings,
//       });
//     }
//   }

//   return { valid, invalid };
// }
