#!/usr/bin/env node

import { Command } from "commander";
import init from "../commands/init";

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
  .command("snapshot")
  .description("Create a new schema snapshot")
  .action(async () => {
    console.log("Snapshot command not yet implemented.");
  });

program
  .command("diff")
  .description("Detect schema changes")
  .action(async () => {
    console.log("Diff command not yet implemented.");
  });

program
  .command("generate")
  .description("Generate a migration file")
  .action(() => {
    console.log("Generate command not yet implemented.");
  });

program
  .command("apply")
  .description("Apply migrations to the database")
  .action(() => {
    console.log("Apply command not yet implemented.");
  });

program.parse(process.argv);
