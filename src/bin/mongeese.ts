#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "fs";
import { join } from "path";
import init from "../commands/init";
import generate from "../commands/generate";
import migrate from "../commands/migrate";

const program = new Command();

// Get package.json version dynamically (CommonJS approach)
function getPackageVersion(): string {
  try {
    // Go up two levels from src/bin/ to reach package.json
    const packagePath = join(__dirname, "..", "..", "package.json");

    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));

    return packageJson.version;
  } catch (error) {
    return "1.0.0";
  }
}

program
  .name("mongeese")
  .description(
    "Auto-generate MongoDB migration scripts by detecting changes in your Mongoose schemas."
  )
  .version(getPackageVersion());

program
  .command("init")
  .description("Initialize mongeese in your project")
  .action(async () => {
    await init();
  });

program
  .command("generate")
  .description("Generate a migration file")
  .option("-n, --name <name>", "Name for the migration file")
  .action(async cmdObj => {
    await generate({ name: cmdObj.name });
  });

program
  .command("migrate [direction]")
  .description("Apply, rollback, or show status of migrations")
  .option("-t, --target <target>", "Target migration filename or timestamp")
  // .option("--dry", "Dry run (no changes will be made)")
  // .option("-f, --force", "Force apply/rollback migrations")
  .action(async (direction = "status", cmdObj) => {
    await migrate(direction, {
      target: cmdObj.target,
      dry: !!cmdObj.dry,
      force: !!cmdObj.force,
    });
  });

program.parse(process.argv);
