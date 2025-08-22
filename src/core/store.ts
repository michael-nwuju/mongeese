import { Db, Collection, Filter, WithId } from "mongodb";
import { Migration } from "../types";
import { ClientSession } from "mongoose";

export class MigrationStore {
  private db: Db;

  private migrations: Collection<Migration>;

  constructor(db: Db) {
    this.db = db;

    this.migrations = db.collection("mongeese.migrations");
  }

  /**
   * Check if the store has been initialized already
   */
  async isInitialized(): Promise<boolean> {
    try {
      // Check if the required collections exist
      const collections = await this.db.listCollections().toArray();

      const collectionNames = collections.map(c => c.name);

      return collectionNames.includes("mongeese.migrations");
    } catch {
      // If any error occurs, consider not initialized
      return false;
    }
  }

  /**
   * Initialize the migration store by creating indexes
   */
  async initialize(): Promise<void> {
    // Check if already initialized
    if (await this.isInitialized()) {
      return;
    }

    // Create indexes for migrations collection
    await this.migrations.createIndex({ filename: 1 }, { unique: true });

    await this.migrations.createIndex({ "from.hash": 1 });

    await this.migrations.createIndex({ "to.hash": 1 });

    await this.migrations.createIndex({ createdAt: -1 });
  }

  // ===== MIGRATION METHODS =====

  /**
   * Create a migration record
   */
  async createMigration(
    migrationId: string,
    fromHash: string,
    toHash: string,
    upCommands: string[],
    downCommands: string[]
  ): Promise<Migration> {
    const migration: Migration = {
      name: migrationId,
      from: {
        _id: undefined!, // No longer storing snapshot references
        hash: fromHash,
      },
      to: {
        _id: undefined!, // No longer storing snapshot references
        hash: toHash,
      },
      up: upCommands,
      down: downCommands,
      createdAt: new Date(),
    };

    const result = await this.migrations.insertOne(migration);
    migration._id = result.insertedId;

    return migration;
  }

  /**
   * Get a migration by ID
   */
  async getMigrationById(id: string): Promise<Migration | null> {
    return await this.migrations.findOne({ id });
  }

  /**
   * Get all migrations
   */
  async getAllMigrations(): Promise<Migration[]> {
    return await this.migrations.find({}).sort({ createdAt: -1 }).toArray();
  }

  /**
   * Find migration
   */
  async findMigration(
    filter: Filter<Migration>
  ): Promise<WithId<Migration> | null> {
    return await this.migrations.findOne(filter);
  }

  /**
   * Get all applied migrations (isApplied: true)
   */
  async getAppliedMigrations(): Promise<Migration[]> {
    return await this.migrations
      .find({ isApplied: true })
      .sort({ appliedAt: 1 })
      .toArray();
  }

  /**
   * Extract date from file name
   */
  private dateFromFilename(filename: string): Date {
    const match = filename.match(
      /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/
    );
    if (!match) throw new Error("Invalid filename format");

    const [_, year, month, day, hour, minute, second] = match;
    return new Date(
      Number(year),
      Number(month) - 1, // JS months are 0-based
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
  }

  /**
   * Mark a migration as applied or not applied
   */
  async setMigrationApplied(
    filename: string,
    isApplied: boolean,
    executionTime: number,
    session?: ClientSession
  ): Promise<void> {
    await this.migrations.updateOne(
      { filename },
      {
        $set: {
          isApplied,
          appliedAt: isApplied ? new Date() : null,
          executionTime,
          createdAt: this.dateFromFilename(filename),
        },
      },
      { upsert: true, session }
    );
  }
}
