import chalk from "chalk";
import { GenerateMigrationOptions } from "../types";
import { getDatabase } from "../utilities/get-database";
import { generateMigrationPreview } from "../core/generate";
import { generateSnapshotFromCodebase } from "../core/detection";

/**
 * Main generate command function
 */
export default async function generate(
  options: GenerateMigrationOptions = {}
): Promise<void> {
  try {
    console.log(chalk.cyan("🔍 Generating migration..."));

    // Load database connection
    const db = await getDatabase();

    console.log(chalk.green("✅ Database connection established"));

    // Import store and snapshot utilities
    const { MigrationStore } = await import("../core/store");
    const { generateSnapshot } = await import("../core/snapshot");
    const { diffSnapshots } = await import("../core/diff");

    // Initialize the migration store
    const store = new MigrationStore(db);

    await store.initialize();

    const { snapshot: currentSnapshot } = await generateSnapshotFromCodebase();

    await store.storeSnapshot(currentSnapshot);

    const latestSnapshot = await generateSnapshot(db, 1);

    await store.storeSnapshot(latestSnapshot);

    const diffResult = diffSnapshots(latestSnapshot, currentSnapshot);

    // Check if there are any changes
    const hasChanges = diffResult.up.length > 0 || diffResult.down.length > 0;

    if (!hasChanges) {
      console.log(chalk.green("✅ No schema changes detected."));

      console.log(
        chalk.cyan(
          "💡 Make changes to your schemas and run this command again."
        )
      );

      return;
    }

    // Show detected changes summary
    if (hasChanges) {
      console.log(chalk.green(`✅ Detected changes:`));

      const { metadata } = diffResult;

      if (metadata.collections.added.length > 0) {
        console.log(
          chalk.cyan(
            `   • Collections added: ${metadata.collections.added.join(", ")}`
          )
        );
      }

      if (metadata.collections.removed.length > 0) {
        console.log(
          chalk.yellow(
            `   • Collections removed: ${metadata.collections.removed.join(
              ", "
            )}`
          )
        );
      }

      if (metadata.collections.modified.length > 0) {
        console.log(
          chalk.cyan(
            `   • Collections modified: ${metadata.collections.modified.join(
              ", "
            )}`
          )
        );
      }

      const totalFieldChanges =
        metadata.fields.added.length +
        metadata.fields.removed.length +
        metadata.fields.modified.length +
        metadata.fields.renamed.length;

      if (totalFieldChanges > 0) {
        console.log(chalk.cyan(`   • Field changes: ${totalFieldChanges}`));
      }

      const totalIndexChanges =
        metadata.indexes.added.length + metadata.indexes.removed.length;

      if (totalIndexChanges > 0) {
        console.log(chalk.cyan(`   • Index changes: ${totalIndexChanges}`));
      }
    }

    // Generate migration preview file
    console.log(chalk.cyan("📝 Generating migration file..."));

    await generateMigrationPreview(diffResult, options);

    // Show next steps
    console.log(chalk.cyan("\n📝 Next Steps:"));

    console.log(chalk.cyan("   1. Review the generated migration file"));

    console.log(
      chalk.cyan("   2. Edit if necessary (add custom logic, modify commands)")
    );

    console.log(
      chalk.cyan(`   3. Run 'mongeese migrate up' to apply the migration`)
    );

    if (diffResult.warnings.length > 0) {
      console.log(
        chalk.yellow(
          "\n⚠️  Please review warnings before applying the migration!"
        )
      );
    }
    process.exit(0);
  } catch (error) {
    console.error(chalk.red("❌ Error generating migration:"), error);
    process.exit(1);
  }
}
