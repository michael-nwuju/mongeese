import chalk from "chalk";
import { MigrateOptions } from "../types";
import { getDatabase } from "../utilities/get-database";
import {
  applyMigrations,
  rollbackMigrations,
  showMigrationStatus,
} from "../core/migration";

/**
 * Main migrate command function
 */
export default async function migrate(
  direction: string = "status",
  options: MigrateOptions = {}
): Promise<void> {
  try {
    // Load database connection
    const db = await getDatabase();

    console.log(chalk.green("✅ Database connection established"));

    switch (direction.toLowerCase()) {
      case "up":
        await applyMigrations(db, { ...options, direction: "up" });
        break;

      case "down":
        await rollbackMigrations(db, { ...options, direction: "down" });
        break;

      case "status":
      default:
        await showMigrationStatus(db);
        break;
    }
  } catch (error) {
    console.error(chalk.red("❌ Migration error:"), error);
    process.exit(1);
  }
}
