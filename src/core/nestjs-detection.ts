import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import mongoose, { Schema, Model } from "mongoose";
import * as path from "path";
import { glob } from "glob";
import { ModelDetectionConfig } from "../types";

/**
 * Enhanced detection specifically for NestJS projects
 */
export class NestJSModelDetector {
  /**
   * Discovers NestJS schema files using common patterns
   */
  static async discoverNestJSSchemaFiles(
    config: ModelDetectionConfig = {}
  ): Promise<string[]> {
    const nestjsPatterns = [
      // Standard NestJS patterns
      "**/*.schema.{js,ts}",
      "**/*.model.{js,ts}",
      "**/schemas/**/*.{js,ts}",
      "**/entities/**/*.{js,ts}", // Some use entities folder
      "**/models/**/*.{js,ts}",

      // Module-specific patterns
      "**/modules/**/schemas/**/*.{js,ts}",
      "**/modules/**/*.schema.{js,ts}",
      "**/src/**/schemas/**/*.{js,ts}",
      "**/src/**/*.schema.{js,ts}",

      // Custom patterns from config
      ...(config.modelPaths || []),
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
      } catch (error) {
        console.warn(
          `[Mongeese] Failed to glob NestJS pattern ${pattern}:`,
          error
        );
      }
    }

    return [...new Set(allFiles)];
  }

  /**
   * Loads NestJS schema files and extracts schema definitions
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
        // Clear require cache
        delete require.cache[path.resolve(filePath)];

        const moduleExports = require(filePath);

        // Look for exported schemas and their metadata
        const schemaInfo = this.extractSchemaFromModule(
          moduleExports,
          filePath
        );
        if (schemaInfo) {
          schemas.push(schemaInfo);
        }
      } catch (error) {
        errors.push({ file: filePath, error });
      }
    }

    return { schemas, errors };
  }

  /**
   * Extracts schema information from a loaded module
   */
  private static extractSchemaFromModule(
    moduleExports: any,
    filePath: string
  ): { name: string; schema: Schema; collectionName?: string } | null {
    // Method 1: Look for Schema class with @Schema() decorator
    for (const [exportName, exportValue] of Object.entries(moduleExports)) {
      if (exportValue && typeof exportValue === "function") {
        // Check if it's a class with Mongoose metadata
        const schemaMetadata = Reflect.getMetadata?.(
          "__mongoose_schema__",
          exportValue
        );
        if (schemaMetadata) {
          return {
            name: exportName,
            schema: schemaMetadata,
            collectionName: this.extractCollectionName(exportValue, exportName),
          };
        }
      }
    }

    // Method 2: Look for explicit Schema exports
    if (moduleExports.schema && moduleExports.schema instanceof Schema) {
      const name =
        moduleExports.name || path.basename(filePath, path.extname(filePath));
      return {
        name,
        schema: moduleExports.schema,
        collectionName: moduleExports.collectionName,
      };
    }

    // Method 3: Look for SchemaFactory.createForClass results
    for (const [key, value] of Object.entries(moduleExports)) {
      if (value instanceof Schema) {
        return {
          name: key,
          schema: value as Schema,
          collectionName: this.inferCollectionName(key),
        };
      }
    }

    return null;
  }

  /**
   * Extracts collection name from NestJS schema class
   */
  private static extractCollectionName(
    schemaClass: any,
    fallbackName: string
  ): string {
    // Check for @Schema({ collection: 'name' }) decorator
    const schemaOptions = Reflect.getMetadata?.(
      "__mongoose_schema_options__",
      schemaClass
    );
    if (schemaOptions?.collection) {
      return schemaOptions.collection;
    }

    // Infer from class name
    return this.inferCollectionName(fallbackName);
  }

  /**
   * Infers collection name from schema name (plural, lowercase)
   */
  private static inferCollectionName(schemaName: string): string {
    // Remove 'Schema' suffix if present
    let name = schemaName.replace(/Schema$/, "");

    // Convert PascalCase to lowercase
    name = name.charAt(0).toLowerCase() + name.slice(1);

    // Simple pluralization (extend this for better pluralization)
    if (name.endsWith("y")) {
      return name.slice(0, -1) + "ies";
    } else if (
      name.endsWith("s") ||
      name.endsWith("x") ||
      name.endsWith("ch") ||
      name.endsWith("sh")
    ) {
      return name + "es";
    } else {
      return name + "s";
    }
  }

  /**
   * Registers discovered schemas with Mongoose
   */
  static registerSchemasWithMongoose(
    schemas: Array<{ name: string; schema: Schema; collectionName?: string }>
  ): Model<any>[] {
    const models: Model<any>[] = [];

    for (const { name, schema, collectionName } of schemas) {
      try {
        // Check if model already exists
        if (mongoose.models[name]) {
          models.push(mongoose.models[name]);
          continue;
        }

        // Register the model
        const model = mongoose.model(name, schema, collectionName);
        models.push(model);

        console.log(
          `[Mongeese] Registered NestJS model: ${name} -> ${model.collection.collectionName}`
        );
      } catch (error) {
        console.warn(`[Mongeese] Failed to register model ${name}:`, error);
      }
    }

    return models;
  }

  /**
   * Attempts to bootstrap a minimal NestJS app to register models
   */
  static async bootstrapNestJSApp(config: ModelDetectionConfig = {}): Promise<{
    models: Model<any>[];
    errors: any[];
  }> {
    const errors: any[] = [];
    let models: Model<any>[] = [];

    try {
      // Try to find app.module.ts or main.ts
      const appFiles = await glob("**/app.module.{js,ts}", {
        ignore: ["**/node_modules/**", "**/dist/**"],
        absolute: true,
      });

      if (appFiles.length === 0) {
        throw new Error("No app.module.ts found - cannot bootstrap NestJS app");
      }

      const { NestFactory } = require("@nestjs/core");
      const appModule = require(appFiles[0]);

      // Create a minimal NestJS application
      const app = await NestFactory.create(
        appModule.AppModule || appModule.default,
        {
          logger: false, // Disable logging during bootstrap
        }
      );

      // Get the mongoose connection from the app
      const connection = app.get("DatabaseConnection") || mongoose.connection;

      // Extract registered models
      models = Object.values(mongoose.models) as Model<any>[];

      await app.close();
    } catch (error) {
      errors.push(error);

      if ((error as any).message) {
        console.warn(
          "[Mongeese] Failed to bootstrap NestJS app:",
          (error as any).message
        );
      }
    }

    return { models, errors };
  }
}

// Enhanced detection function that automatically tries multiple methods
export async function generateNestJSSnapshot(
  config: ModelDetectionConfig = {}
) {
  console.log("[Mongeese] 🔍 Using enhanced NestJS model detection...");

  let allModels: Model<any>[] = [];
  const errors: any[] = [];
  let detectionMethod = "none";

  // Method 1: Try to bootstrap NestJS app (most reliable)
  // This is enabled by default for NestJS projects
  console.log("[Mongeese] 🚀 Attempting to bootstrap NestJS application...");
  try {
    const { models: bootstrapModels, errors: bootstrapErrors } =
      await NestJSModelDetector.bootstrapNestJSApp(config);

    if (bootstrapModels.length > 0) {
      allModels.push(...bootstrapModels);
      detectionMethod = "bootstrap";
      console.log(
        `[Mongeese] ✅ Bootstrap successful: ${bootstrapModels.length} models found`
      );
    } else {
      console.log("[Mongeese] ⚠️  Bootstrap completed but no models found");
    }

    errors.push(...bootstrapErrors);
  } catch (error) {
    console.log("[Mongeese] ⚠️  Bootstrap failed, will try file discovery");
    errors.push(error);
  }

  // Method 2: Direct schema file discovery (fallback or supplement)
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
          detectionMethod =
            allModels.length > 0 ? "file-discovery" : detectionMethod;
        }

        errors.push(...loadErrors);
      }
    } catch (error) {
      errors.push(error);

      if ((error as any).message) {
        console.warn(
          "[Mongeese] ⚠️  Schema file discovery failed:",
          (error as any).message
        );
      }
    }
  }

  // Method 3: Check for already registered models (last resort)
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

  // Final summary
  if (allModels.length === 0) {
    console.log(
      "[Mongeese] ❌ No NestJS models detected. Troubleshooting tips:"
    );
    console.log("   • Ensure your schemas use @Schema() decorator");
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
