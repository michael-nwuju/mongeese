import "reflect-metadata";
import { Module } from "@nestjs/common";
import { MongooseModule, getConnectionToken } from "@nestjs/mongoose";
import mongoose, { Schema, Model, Connection } from "mongoose";
import * as path from "path";
import { glob } from "glob";
import { ModelDetectionConfig } from "../types";

/**
 * Enhanced detection specifically for NestJS projects
 */
export class NestJSModelDetector {
  /**
   * Discover NestJS schema files using common & fallback patterns
   */
  static async discoverNestJSSchemaFiles(
    config: ModelDetectionConfig = {}
  ): Promise<string[]> {
    const nestjsPatterns = [
      "**/*.schema.{js,ts}",
      "**/*.model.{js,ts}",
      "**/*Schema.{js,ts}",
      "**/*.entity.{js,ts}", // for people migrating from TypeORM
      "**/schemas/**/*.{js,ts}",
      "**/entities/**/*.{js,ts}",
      "**/models/**/*.{js,ts}",
      "**/modules/**/schemas/**/*.{js,ts}",
      "**/modules/**/*.schema.{js,ts}",
      "**/src/**/schemas/**/*.{js,ts}",
      "**/src/**/*.schema.{js,ts}",
      ...(config.modelPaths || []), // custom user patterns
    ];

    const allFiles: string[] = [];
    for (const pattern of nestjsPatterns) {
      try {
        const files = await glob(pattern, {
          ignore: [
            "**/node_modules/**",
            "**/dist/**",
            "**/build/**",
            "**/*.spec.ts",
            "**/*.test.ts",
          ],
          absolute: true,
        });
        allFiles.push(...files);
      } catch (err) {
        console.warn(
          `[Mongeese] Failed to glob NestJS pattern ${pattern}:`,
          err
        );
      }
    }

    return [...new Set(allFiles)];
  }

  /**
   * Load schema files and extract schema definitions
   */
  static async loadNestJSSchemaFiles(filePaths: string[]): Promise<{
    schemas: Array<{ name: string; schema: Schema; collectionName?: string }>;
    errors: Array<{ file: string; error: any }>;
  }> {
    const schemas: Array<{
      name: string;
      schema: Schema;
      collectionName?: string;
    }> = [];
    const errors: Array<{ file: string; error: any }> = [];

    for (const filePath of filePaths) {
      try {
        delete require.cache[path.resolve(filePath)];
        const moduleExports = require(filePath);

        const foundSchemas = this.extractSchemasFromExports(
          moduleExports,
          filePath
        );

        schemas.push(...foundSchemas);
      } catch (err) {
        errors.push({ file: filePath, error: err });
      }
    }

    return { schemas, errors };
  }

  /**
   * Extract schemas from a given module's exports
   */
  private static extractSchemasFromExports(
    moduleExports: any,
    filePath: string
  ): Array<{ name: string; schema: Schema; collectionName?: string }> {
    const results: Array<{
      name: string;
      schema: Schema;
      collectionName?: string;
    }> = [];

    for (const [exportName, exportValue] of Object.entries(moduleExports)) {
      // Method 1: Class with @Schema() decorator
      const schemaMetadata = Reflect.getMetadata?.(
        "__mongoose_schema__",
        exportValue as any
      );

      if (schemaMetadata instanceof Schema) {
        results.push({
          name: exportName,
          schema: schemaMetadata,
          collectionName: this.extractCollectionName(exportValue, exportName),
        });
        continue;
      }

      // Method 2: Direct Schema export
      if (exportValue instanceof Schema) {
        results.push({
          name: exportName,
          schema: exportValue,
          collectionName: this.inferCollectionName(exportName),
        });
        continue;
      }

      // Method 3: SchemaFactory.createForClass() result
      if (
        exportValue?.constructor?.name === "Schema" &&
        (exportValue as any)?.obj
      ) {
        results.push({
          name: exportName,
          schema: exportValue as Schema,
          collectionName: this.inferCollectionName(exportName),
        });
      }
    }

    return results;
  }

  /**
   * Extract collection name from NestJS schema class
   */
  private static extractCollectionName(
    schemaClass: any,
    fallbackName: string
  ): string {
    const schemaOptions = Reflect.getMetadata?.(
      "__mongoose_schema_options__",
      schemaClass
    );
    if (schemaOptions?.collection) {
      return schemaOptions.collection;
    }
    return this.inferCollectionName(fallbackName);
  }

  /**
   * Infer collection name from schema name
   */
  private static inferCollectionName(schemaName: string): string {
    let name = schemaName.replace(/Schema$/, "");
    name = name.charAt(0).toLowerCase() + name.slice(1);

    if (name.endsWith("y")) return name.slice(0, -1) + "ies";
    if (/(s|x|ch|sh)$/.test(name)) return name + "es";
    return name + "s";
  }

  /**
   * Register discovered schemas with mongoose
   */
  static registerSchemasWithMongoose(
    schemas: Array<{ name: string; schema: Schema; collectionName?: string }>
  ): Model<any>[] {
    const models: Model<any>[] = [];
    for (const { name, schema, collectionName } of schemas) {
      try {
        if (mongoose.models[name]) {
          models.push(mongoose.models[name]);
          continue;
        }
        const model = mongoose.model(name, schema, collectionName);
        models.push(model);
        console.log(
          `[Mongeese] Registered NestJS model: ${name} -> ${model.collection.collectionName}`
        );
      } catch (err) {
        console.warn(`[Mongeese] Failed to register model ${name}:`, err);
      }
    }
    return models;
  }

  /**
   * Bootstrap a minimal NestJS app to detect models
   */
  static async bootstrapNestJSApp(config: ModelDetectionConfig = {}): Promise<{
    models: Model<any>[];
    errors: any[];
  }> {
    const errors: any[] = [];
    let models: Model<any>[] = [];

    try {
      const appFiles = await glob("**/app.module.{js,ts}", {
        ignore: ["**/node_modules/**", "**/dist/**"],
        absolute: true,
      });

      if (appFiles.length === 0) {
        throw new Error("No app.module.ts found - cannot bootstrap NestJS app");
      }

      const { NestFactory } = require("@nestjs/core");
      const appModule = require(appFiles[0]);

      const app = await NestFactory.create(
        appModule.AppModule || appModule.default,
        { logger: false }
      );

      await app.init();

      const connection: Connection = app.get(getConnectionToken());
      models = connection.modelNames().map(name => connection.model(name));

      await app.close();
    } catch (err: any) {
      errors.push(err);
      console.warn("[Mongeese] Failed to bootstrap NestJS app:", err.message);
    }

    return { models, errors };
  }
}

/**
 * Main enhanced detection function
 */
export async function generateNestJSSnapshot(
  config: ModelDetectionConfig = {}
) {
  let allModels: Model<any>[] = [];

  const errors: any[] = [];

  let detectionMethod = "none";

  // Method 1: Bootstrap NestJS app
  console.log("[Mongeese] 🚀 Attempting to bootstrap NestJS application...");
  try {
    const { models: bootstrapModels, errors: bootstrapErrors } =
      await NestJSModelDetector.bootstrapNestJSApp(config);

    if (bootstrapModels.length > 0) {
      allModels.push(...bootstrapModels);
      detectionMethod = "bootstrap";
      console.log(
        `\n[Mongeese] ✅ Bootstrap successful: ${bootstrapModels.length} models found`
      );
    } else {
      console.log("[Mongeese] ⚠️ Bootstrap completed but no models found");
    }
    errors.push(...bootstrapErrors);
  } catch (err) {
    console.log("[Mongeese] ⚠️ Bootstrap failed, will try file discovery");
    errors.push(err);
  }

  // Method 2: File discovery if bootstrap fails
  if (allModels.length === 0) {
    console.log("[Mongeese] 📁 Discovering NestJS schema files...");
    try {
      const schemaFiles = await NestJSModelDetector.discoverNestJSSchemaFiles(
        config
      );
      console.log(`[Mongeese] 📂 Found ${schemaFiles.length} schema files`);

      if (schemaFiles.length > 0) {
        const { schemas, errors: loadErrors } =
          await NestJSModelDetector.loadNestJSSchemaFiles(schemaFiles);

        console.log(`[Mongeese] 🔍 Extracted ${schemas.length} schemas`);
        if (schemas.length > 0) {
          const discoveredModels =
            NestJSModelDetector.registerSchemasWithMongoose(schemas);
          allModels.push(...discoveredModels);
          if (allModels.length > 0) detectionMethod = "file-discovery";
        }
        errors.push(...loadErrors);
      }
    } catch (err: any) {
      errors.push(err);
      console.warn("[Mongeese] ⚠️ Schema file discovery failed:", err.message);
    }
  }

  // Method 3: Check existing mongoose models
  if (allModels.length === 0) {
    console.log(
      "[Mongeese] 🔄 Checking for already registered Mongoose models..."
    );
    const existingModels = Object.values(mongoose.models) as Model<any>[];
    if (existingModels.length > 0) {
      allModels = existingModels;
      detectionMethod = "existing";
      console.log(
        `[Mongeese] ✅ Found ${existingModels.length} existing models`
      );
    }
  }

  if (allModels.length === 0) {
    console.log(
      "[Mongeese] ❌ No NestJS models detected. Troubleshooting tips:"
    );
    console.log(
      "   • Ensure your schemas use @Schema() decorator or SchemaFactory.createForClass"
    );
    console.log(
      "   • Check that MongooseModule.forFeature() is used in modules"
    );
    console.log(
      "   • Verify schema files are in standard locations (*.schema.ts)"
    );
    console.log("   • Make sure your NestJS app can bootstrap without errors");
  }

  return {
    models: allModels,
    errors,
    metadata: {
      detectionMethod,
      modelCount: allModels.length,
      errorCount: errors.length,
    },
  };
}
