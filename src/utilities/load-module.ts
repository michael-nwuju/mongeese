import * as path from "path";
import { isESModuleProject } from "./is-esm-module-project";
import { maskSensitiveInfo, safeResolve } from "./security-utils";

/**
 * Load a module with compatibility for both CommonJS and ES modules
 */
export async function loadModule(filePath: string): Promise<any> {
  const resolvedPath = safeResolve(process.cwd(), filePath);
  const isESProject = isESModuleProject(process.cwd());

  // Validate file exists and is readable
  try {
    await import("fs").then(fs =>
      fs.promises.access(resolvedPath, fs.constants.R_OK)
    );
  } catch (error) {
    throw new Error(`Cannot access file: ${path.basename(filePath)}`);
  }

  // If it's an ES module project, we need to use dynamic import
  if (isESProject && filePath.endsWith(".js")) {
    try {
      // Convert to file URL for proper ES module import
      const fileUrl =
        process.platform === "win32"
          ? `file:///${resolvedPath.replace(/\\/g, "/")}`
          : `file://${resolvedPath}`;

      // Use Function constructor to avoid TypeScript issues with dynamic import
      const importFn = new Function("specifier", "return import(specifier)");
      const module = await importFn(fileUrl);
      return module.default || module;
    } catch (importError) {
      const maskedError = maskSensitiveInfo(
        importError instanceof Error ? importError.message : String(importError)
      );

      throw new Error(
        `Failed to import ES module ${path.basename(
          filePath
        )}: ${maskedError}\n` +
          `This is likely because your project has "type": "module" in package.json.\n` +
          `Solutions:\n` +
          `1. Rename your bootstrap file to mongeese.connection.cjs\n` +
          `2. Or remove "type": "module" from package.json if not needed\n` +
          `3. Or ensure your bootstrap file uses proper ES module syntax (export instead of module.exports)`
      );
    }
  }

  // For CommonJS projects or .cjs files, use require
  try {
    // Clear require cache for fresh load
    if (typeof require !== "undefined" && require.cache) {
      delete require.cache[resolvedPath];
    }

    return require(resolvedPath);
  } catch (requireError) {
    // Check if this is the ES module error
    const errorMessage =
      requireError instanceof Error
        ? requireError.message
        : String(requireError);

    const maskedError = maskSensitiveInfo(errorMessage);

    if (errorMessage.includes("require() of ES Module")) {
      throw new Error(
        `Cannot require ES module ${path.basename(filePath)}.\n` +
          `Your project has "type": "module" in package.json, which treats all .js files as ES modules.\n` +
          `Solutions:\n` +
          `1. Rename your bootstrap file to mongeese.connection.cjs\n` +
          `2. Or change your bootstrap file to use ES module syntax:\n` +
          `   Replace: module.exports = { getDbWithClient }\n` +
          `   With: export { getDbWithClient }\n` +
          `3. Or remove "type": "module" from package.json if you want to use CommonJS`
      );
    }

    throw new Error(
      `Failed to load module ${path.basename(filePath)}: ${maskedError}`
    );
  }
}
