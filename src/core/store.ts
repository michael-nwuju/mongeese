import { Db, Collection } from "mongodb";
import { MongeeseMigration, MongeeseConfig } from "../interfaces/snapshot";

export class MigrationStore {
  private db: Db;

  private migrationsCollection: Collection<MongeeseMigration>;

  private configCollection: Collection<MongeeseConfig>;

  constructor(db: Db) {
    this.db = db;

    this.configCollection = db.collection("mongeese-config");

    this.migrationsCollection = db.collection("mongeese-migrations");
  }

  /**
   * Check if the store has been initialized already
   */
  async isInitialized(): Promise<boolean> {
    try {
      // Check if the config collection exists and has the initialization flag
      const initConfig = await this.configCollection.findOne({
        key: "initialized",
      });
      return !!initConfig;
    } catch {
      // If collection doesn't exist or any error, consider not initialized
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
    await this.migrationsCollection.createIndex({ timestamp: -1 });

    await this.migrationsCollection.createIndex(
      { version: 1 },
      { unique: true }
    );

    await this.migrationsCollection.createIndex({ applied: 1 });

    // Create indexes for config collection
    await this.configCollection.createIndex({ key: 1 }, { unique: true });

    // Mark as initialized
    await this.setConfig("initialized", true);
  }

  /**
   * Get configuration value
   */
  async getConfig(key: string): Promise<any> {
    const config = await this.configCollection.findOne({ key });
    return config?.value;
  }

  /**
   * Set configuration value
   */
  async setConfig(key: string, value: any): Promise<void> {
    await this.configCollection.updateOne(
      { key },
      {
        $set: {
          value,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  /**
   * Generate a unique version string based on timestamp
   */
  private generateVersion(): string {
    const now = new Date();
    const timestamp = now.getTime();
    const random = Math.floor(Math.random() * 1000);
    return `${timestamp}-${random}`;
  }

  /**
   * Check if this is the first time running mongeese
   */
  async isFirstRun(): Promise<boolean> {
    const count = await this.migrationsCollection.countDocuments();
    return count === 0;
  }
}
