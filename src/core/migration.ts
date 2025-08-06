import chalk from "chalk";
import { Db } from "mongodb";
import {
  getMigrationFiles,
  loadMigrationFile,
  validateMigrationFile,
  getPendingMigrations,
  formatMigrationTimestamp,
  MigrationFile,
} from "./reader";
import { MigrateOptions } from "../types";
import { MigrationStore } from "./store";

/**
 * Get applied migrations from database (now using isApplied in mongeese.migrations)
 */
export async function getAppliedMigrations(db: Db): Promise<any[]> {
  return await new MigrationStore(db).getAppliedMigrations();
}

/**
 * Record migration as applied or rolled back
 */
export async function recordMigrationApplied(
  db: Db,
  migration: MigrationFile,
  direction: "up" | "down",
  executionTime: number
): Promise<void> {
  const store = new MigrationStore(db);
  await store.setMigrationApplied(
    migration.filename,
    direction === "up",
    executionTime
  );
}

/**
 * Execute a single migration
 */
export async function executeMigration(
  db: Db,
  migration: MigrationFile,
  direction: "up" | "down",
  options: MigrateOptions
): Promise<void> {
  console.log(
    chalk.cyan(
      `\n🚀 ${
        direction === "up" ? "Applying" : "Reverting"
      } migration: ${chalk.bold(migration.name)}`
    )
  );

  console.log(chalk.gray(`   File: ${migration.filename}`));

  console.log(
    chalk.gray(`   Created: ${formatMigrationTimestamp(migration.timestamp)}`)
  );

  if (options.dry) {
    return console.log(
      chalk.yellow("   [DRY RUN] Migration would be executed")
    );
  }

  const startTime = Date.now();

  try {
    // Load the migration file
    const loadedMigration = await loadMigrationFile(migration);

    if (!loadedMigration.instance) {
      throw new Error("Migration instance not loaded");
    }

    // Execute the migration
    if (direction === "up") {
      await loadedMigration.instance.up(db);
    } else {
      await loadedMigration.instance.down(db);
    }

    const executionTime = Date.now() - startTime;

    // Record the migration
    await recordMigrationApplied(db, migration, direction, executionTime);

    console.log(
      chalk.green(
        `   ✅ Migration ${
          direction === "up" ? "applied" : "reverted"
        } successfully (${executionTime}ms)`
      )
    );
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error(
      chalk.red(`   ❌ Migration failed after ${executionTime}ms:`),
      error
    );
    throw error;
  }
}

/**
 * Apply pending migrations (up)
 */
export async function applyMigrations(
  db: Db,
  options: MigrateOptions
): Promise<void> {
  const appliedMigrations = await getAppliedMigrations(db);

  const appliedFilenames = appliedMigrations.map(m => m.filename);

  let pendingMigrations = await getPendingMigrations(appliedFilenames);

  if (options.target) {
    // Filter to only migrations up to the target
    const targetIndex = pendingMigrations.findIndex(
      m => m.filename === options.target || m.timestamp === options.target
    );

    if (targetIndex === -1) {
      throw new Error(`Target migration not found: ${options.target}`);
    }

    pendingMigrations = pendingMigrations.slice(0, targetIndex + 1);
  }

  if (pendingMigrations.length === 0) {
    return console.log(chalk.green("✅ No pending migrations to apply."));
  }

  console.log(
    chalk.cyan(`\n📋 Found ${pendingMigrations.length} pending migration(s):`)
  );

  if (options.dry) {
    console.log(chalk.yellow("\n🔍 DRY RUN - No changes will be made\n"));
  }

  // Validate all migrations first
  console.log(chalk.cyan("🔍 Validating migrations..."));

  for (const migration of pendingMigrations) {
    const validation = await validateMigrationFile(migration);

    if (!validation.valid) {
      console.error(chalk.red(`❌ Invalid migration ${migration.filename}:`));

      validation.errors.forEach(error =>
        console.error(chalk.red(`   • ${error}`))
      );

      throw new Error("Migration validation failed");
    }

    if (validation.warnings.length > 0) {
      console.warn(chalk.yellow(`⚠️  Warnings for ${migration.filename}:`));

      validation.warnings.forEach(warning =>
        console.warn(chalk.yellow(`   • ${warning}`))
      );
    }
  }

  console.log(chalk.green("✅ All migrations validated"));

  // Execute migrations in order
  let successCount = 0;

  for (const migration of pendingMigrations) {
    try {
      await executeMigration(db, migration, "up", options);
      successCount++;
    } catch (error) {
      console.error(chalk.red(`\n❌ Migration failed: ${migration.filename}`));

      if (successCount > 0) {
        console.log(
          chalk.yellow(
            `\n⚠️  ${successCount} migration(s) were applied successfully before the failure.`
          )
        );

        console.log(
          chalk.yellow('   Use "mongeese migrate down" to rollback if needed.')
        );
      }

      throw error;
    }
  }

  console.log(
    chalk.green(`\n🎉 Successfully applied ${successCount} migration(s)!`)
  );
}

/**
 * Rollback migrations (down)
 */
export async function rollbackMigrations(
  db: Db,
  options: MigrateOptions
): Promise<void> {
  const appliedMigrations = await getAppliedMigrations(db);

  if (appliedMigrations.length === 0) {
    return console.log(chalk.green("✅ No applied migrations to rollback."));
  }

  let migrationsToRollback = appliedMigrations.slice().reverse(); // Most recent first

  if (options.target) {
    // Rollback to a specific target
    const targetIndex = appliedMigrations.findIndex(
      m =>
        m.filename === options?.target ||
        m.filename.includes(options.target as string)
    );

    if (targetIndex === -1) {
      throw new Error(`Target migration not found: ${options.target}`);
    }

    // Rollback everything after the target
    migrationsToRollback = appliedMigrations.slice(targetIndex + 1).reverse();
  } else {
    // Default: rollback only the last migration
    migrationsToRollback = migrationsToRollback.slice(0, 1);
  }

  if (migrationsToRollback.length === 0) {
    return console.log(chalk.green("✅ No migrations to rollback."));
  }

  console.log(
    chalk.yellow(
      `\n📋 Rolling back ${migrationsToRollback.length} migration(s):`
    )
  );

  for (const record of migrationsToRollback) {
    console.log(`  ${chalk.red("↓")} ${chalk.bold(record.filename)}`);
  }

  if (options.dry) {
    console.log(chalk.yellow("\n🔍 DRY RUN - No changes will be made\n"));
  }

  // Get migration files for rollback
  const allMigrationFiles = await getMigrationFiles();

  let successCount = 0;

  for (const record of migrationsToRollback) {
    const migrationFile = allMigrationFiles.find(
      f => f.filename === record.filename
    );

    if (!migrationFile) {
      console.error(
        chalk.red(`❌ Migration file not found: ${record.filename}`)
      );
      continue;
    }

    try {
      await executeMigration(db, migrationFile, "down", options);
      successCount++;
    } catch (error) {
      console.error(chalk.red(`\n❌ Rollback failed: ${record.filename}`));

      if (successCount > 0) {
        console.log(
          chalk.yellow(
            `\n⚠️  ${successCount} migration(s) were rolled back successfully before the failure.`
          )
        );
      }

      throw error;
    }
  }

  console.log(
    chalk.green(`\n🎉 Successfully rolled back ${successCount} migration(s)!`)
  );
}

/**
 * Show migration status
 */
export async function showMigrationStatus(db: Db): Promise<void> {
  const appliedMigrations = await getAppliedMigrations(db);

  const allMigrations = await getMigrationFiles();

  const appliedFilenames = appliedMigrations.map(m => m.filename);

  const pendingMigrations = allMigrations.filter(
    m => !appliedFilenames.includes(m.filename)
  );

  console.log(chalk.cyan("\n📊 Migration Status:\n"));

  if (appliedMigrations.length > 0) {
    console.log(
      chalk.green(`✅ Applied Migrations (${appliedMigrations.length}):`)
    );
    for (const migration of appliedMigrations) {
      const appliedAt = migration.appliedAt.toLocaleString();
      console.log(
        `   ${chalk.green("✓")} ${migration.filename} ${chalk.gray(
          `(applied ${appliedAt})`
        )}`
      );
    }
    console.log();
  }

  if (pendingMigrations.length > 0) {
    console.log(
      chalk.yellow(`⏳ Pending Migrations (${pendingMigrations.length}):`)
    );
    for (const migration of pendingMigrations) {
      const createdAt = formatMigrationTimestamp(migration.timestamp);
      console.log(
        `   ${chalk.yellow("○")} ${migration.filename} ${chalk.gray(
          `(created ${createdAt})`
        )}`
      );
    }
    console.log();
  }

  if (appliedMigrations.length === 0 && pendingMigrations.length === 0) {
    console.log(chalk.gray("No migrations found."));
  }
}
