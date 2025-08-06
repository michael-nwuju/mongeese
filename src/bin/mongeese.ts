#!/usr/bin/env node

import { Command } from "commander";
import init from "../commands/init";
import generate from "../commands/generate";
import migrate from "../commands/migrate";

const program = new Command();

program
  .name("mongeese")
  .description(
    "Auto-generate MongoDB migration scripts by detecting changes in your Mongoose schemas."
  )
  .version("1.0.0");

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
  .option("--dry", "Dry run (no changes will be made)")
  .option("-f, --force", "Force apply/rollback migrations")
  .action(async (direction = "status", cmdObj) => {
    await migrate(direction, {
      target: cmdObj.target,
      dry: !!cmdObj.dry,
      force: !!cmdObj.force,
    });
  });

// program
//   .command("snapshot")
//   .description("Create a new schema snapshot")
//   .action(async () => {
//     console.log("Snapshot command not yet implemented.");
//   });

// program
//   .command("diff")
//   .description("Detect schema changes")
//   .action(async () => {
//     console.log("Diff command not yet implemented.");
//   });

program.parse(process.argv);
