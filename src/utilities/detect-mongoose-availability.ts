/**
 * Detects if Mongoose is available in the project
 */
export async function detectMongooseAvailability(): Promise<boolean> {
  try {
    // Try to require mongoose
    require("mongoose");
    return true;
  } catch {
    // If mongoose is not available, return false
    return false;
  }
}
