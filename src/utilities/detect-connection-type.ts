/**
 * Detects if the connection is from Mongoose or native MongoDB
 */
export function detectConnectionType(connection: any): "mongoose" | "native" {
  // Check if it's a Mongoose connection
  if (
    connection.constructor.name === "Connection" ||
    connection.constructor.name === "Mongoose" ||
    (connection.db && connection.db.constructor.name === "Db")
  ) {
    return "mongoose";
  }

  // Check if it's a native MongoDB Db
  if (
    connection.constructor.name === "Db" ||
    (connection.collections && typeof connection.collections === "function")
  ) {
    return "native";
  }

  // Default to native if we can't determine
  return "native";
}
