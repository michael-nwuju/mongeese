import { Db, Collection, Filter, WithId } from "mongodb";
import { Snapshot, Migration } from "../types";
import { generateSnapshot, verifySnapshot } from "./snapshot";
import { diffSnapshots } from "./diff";

export class MigrationStore {
  private db: Db;

  private snapshots: Collection<Snapshot>;

  private migrations: Collection<Migration>;

  constructor(db: Db) {
    this.db = db;

    this.snapshots = db.collection("mongeese.snapshots");

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

      const hasSnapshotsCollection =
        collectionNames.includes("mongeese.snapshots");

      const hasMigrationsCollection = collectionNames.includes(
        "mongeese.migrations"
      );

      if (!hasSnapshotsCollection || !hasMigrationsCollection) {
        return false;
      }

      // Check if the snapshots collection has the required indexes
      const snapshotsIndexes = await this.snapshots.listIndexes().toArray();

      const hasHashIndex = snapshotsIndexes.some(idx => idx.name === "hash_1");

      return hasHashIndex;
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

    // Create indexes for snapshots collection
    await this.snapshots.createIndex({ hash: 1 }, { unique: true });
    await this.snapshots.createIndex({ version: -1 });
    await this.snapshots.createIndex({ createdAt: -1 });

    // Create indexes for migrations collection
    await this.migrations.createIndex({ id: 1 }, { unique: true });

    await this.migrations.createIndex({ "from.hash": 1 });

    await this.migrations.createIndex({ "to.hash": 1 });

    await this.migrations.createIndex({ createdAt: -1 });
  }

  // ===== SNAPSHOT METHODS =====

  /**
   * Generate and store a new snapshot
   */
  async generateAndStoreSnapshot(version?: number): Promise<Snapshot> {
    return await this.storeSnapshot(await generateSnapshot(this.db, version));
  }

  /**
   * Store a snapshot in the format
   */
  async storeSnapshot(snapshot: Snapshot): Promise<Snapshot> {
    // Verify the snapshot hash before storing
    if (!verifySnapshot(snapshot)) {
      throw new Error("Snapshot hash verification failed");
    }

    // Check if snapshot with this hash already exists
    const existing = await this.snapshots.findOne({ hash: snapshot.hash });

    if (existing) {
      return existing;
    }

    const result = await this.snapshots.insertOne(snapshot);

    snapshot._id = result.insertedId;

    return snapshot;
  }

  /**
   * Get a snapshot by hash
   */
  async getSnapshotByHash(hash: string): Promise<Snapshot | null> {
    return await this.snapshots.findOne({ hash });
  }

  /**
   * Get a snapshot by ID
   */
  async getSnapshotById(id: string): Promise<Snapshot | null> {
    const { ObjectId } = await import("mongodb");
    return await this.snapshots.findOne({ _id: new ObjectId(id) });
  }

  /**
   * Get the latest snapshot
   */
  async getLatestSnapshot(): Promise<Snapshot | null> {
    return await this.snapshots.find({}).sort({ version: -1 }).limit(1).next();
  }

  /**
   * Get all snapshots
   */
  async getAllSnapshots(): Promise<Snapshot[]> {
    return await this.snapshots.find({}).sort({ version: -1 }).toArray();
  }

  /**
   * Verify all stored snapshots
   */
  async verifyAllSnapshots(): Promise<{
    valid: Snapshot[];
    invalid: Snapshot[];
  }> {
    const snapshots = await this.getAllSnapshots();

    const valid: Snapshot[] = [];

    const invalid: Snapshot[] = [];

    for (const snapshot of snapshots) {
      if (verifySnapshot(snapshot)) {
        valid.push(snapshot);
      } else {
        invalid.push(snapshot);
      }
    }

    return { valid, invalid };
  }

  // ===== MIGRATION METHODS =====

  /**
   * Create a migration between two snapshots
   */
  async createMigration(
    from: Snapshot,
    to: Snapshot,
    migrationId: string
  ): Promise<Migration> {
    const { up, down } = diffSnapshots(from, to);

    const migration: Migration = {
      name: migrationId,
      from: {
        _id: from._id!,
        hash: from.hash,
      },
      to: {
        _id: to._id!,
        hash: to.hash,
      },
      up: up.map(cmd => cmd.command),
      down: down.map(cmd => cmd.command),
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
   * Mark a migration as applied or not applied
   */
  async setMigrationApplied(
    filename: string,
    isApplied: boolean,
    executionTime: number
  ): Promise<void> {
    await this.migrations.updateOne(
      { filename },
      {
        $set: {
          isApplied,
          appliedAt: isApplied ? new Date() : null,
          executionTime,
        },
      },
      { upsert: true }
    );
  }
}
