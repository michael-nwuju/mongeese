import { IndexDescription } from "mongodb";

export type FieldMap = { [path: string]: string };

export type Snapshot = {
  [collectionName: string]: {
    fields: FieldMap; // e.g. { "profile.age": "Number" }
    indexes: IndexDescription[];
  };
};

export type DiffResult = {
  added: FieldMap;
  removed: FieldMap;
  changed: { [path: string]: { from: string; to: string } };
  // Optionally, you can add index changes here
};

export type MigrationScript = {
  up: string; // JS or Mongo shell code to apply the migration
  down?: string; // Optional rollback script
};

// New types for database-stored migrations
export interface MongeeseMigration {
  _id?: string;
  timestamp: Date;
  version: string;
  description: string;
  snapshot: Snapshot;
  diff?: DiffResult;
  applied: boolean;
  appliedAt?: Date;
  rollbackAt?: Date;
}

export interface MongeeseConfig {
  _id?: string;
  key: string;
  value: any;
  updatedAt: Date;
}
