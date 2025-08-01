import { Db } from "mongodb";
import { detectConnectionType } from "./detect-connection-type";

/**
 * Extracts the Db instance from either Mongoose or native MongoDB connection
 */
export function extractDb(connection: any): Db {
  const connectionType = detectConnectionType(connection);

  if (connectionType === "mongoose") {
    // For Mongoose, the connection object has a .db property
    return connection.db || connection.connection?.db;
  }

  // For native MongoDB, the connection IS the Db
  return connection;
}
