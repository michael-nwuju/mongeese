import chalk from "chalk";
import fs from "fs-extra";
import detectProjectType from "../utilities/detect-project-type";

const PROJECT_TYPE = detectProjectType();

const EXTENSION = PROJECT_TYPE === "typescript" ? "ts" : "js";

const BOOTSTRAP_FILE = `mongeese.connection.${EXTENSION}`;

const BOOTSTRAP_TEMPLATE_TS = `// mongeese.connection.ts

import mongoose from "mongoose";
import { MongoClient, Db } from "mongodb";

/**
 * Returns a connected MongoDB Db instance for Mongeese to use.
 * Choose one of the two methods below based on your project setup.
 */

// Option 1: If you're using Mongoose in your project
export async function getDbWithMongoose(): Promise<Db> {
  const mongooseConnection = await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb");
  
  if (!mongooseConnection) {
    throw new Error("Failed to connect to MongoDB");
  }
  
  return mongooseConnection.connection.db;
}

// Option 2: If you're using native MongoDB driver
export async function getDbWithNative(): Promise<Db> {
  const client = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb");
  await client.connect();
  return client.db();
}
`;

const BOOTSTRAP_TEMPLATE_JS = `// mongeese.connection.js

const mongoose = require("mongoose");
const { MongoClient } = require("mongodb");

/**
 * Returns a connected MongoDB Db instance for Mongeese to use.
 * Choose one of the two methods below based on your project setup.
 */

// Option 1: If you're using Mongoose in your project
async function getDbWithMongoose() {
    const mongooseConnection = await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb");
  
  if (!mongooseConnection) {
    throw new Error("Failed to connect to MongoDB");
  }
  
  return mongooseConnection.connection.db;
}

// Option 2: If you're using native MongoDB driver
async function getDbWithNative() {
  const client = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb");
  await client.connect();
  return client.db();
}
`;

const BOOTSTRAP_TEMPLATE =
  PROJECT_TYPE === "typescript" ? BOOTSTRAP_TEMPLATE_TS : BOOTSTRAP_TEMPLATE_JS;

export default async function init(): Promise<void> {
  try {
    if (fs.existsSync(BOOTSTRAP_FILE)) {
      return console.log(chalk.yellow(`${BOOTSTRAP_FILE} already exists.`));
    }

    // Create bootstrap file
    fs.writeFileSync(BOOTSTRAP_FILE, BOOTSTRAP_TEMPLATE);

    console.log(chalk.cyan("\n✅ Bootstrap file created!"));

    console.log(chalk.cyan("\nNext steps:"));

    console.log(
      chalk.cyan("1. Edit the connection file to set your MONGODB_URI")
    );

    console.log(
      chalk.cyan("2. Run 'mongeese generate' to create your first snapshot")
    );
    process.exit(0);
  } catch (error) {
    console.error(chalk.red("❌ Error during initialization:"), error);
    process.exit(1);
  }
}
