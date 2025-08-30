import fs from "fs-extra";
import { safeJsonParse } from "./security-utils";

export default function detectProjectType(): "typescript" | "javascript" {
  // 1. Check for explicit TypeScript config files (highest priority)
  const tsConfigFiles = [
    "tsconfig.json",
    "tsconfig.tsbuildinfo",
    "tsconfig.app.json",
    "tsconfig.lib.json",
  ];

  for (const tsFile of tsConfigFiles) {
    if (fs.existsSync(tsFile)) {
      return "typescript";
    }
  }

  // 2. Check package.json for TypeScript dependencies
  if (fs.existsSync("package.json")) {
    try {
      const packageContent = fs.readFileSync("package.json", "utf8");

      const packageJson = safeJsonParse(packageContent);

      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (deps.typescript || deps["@types/node"] || deps["ts-node"]) {
        return "typescript";
      }
    } catch (error) {
      // If we can't read package.json, continue with other checks
    }
  }

  // 3. Check for TypeScript source files in common directories
  const sourceDirs = ["src", "lib", "app"];

  for (const dir of sourceDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir, { recursive: true });
        if (
          files.some(
            file =>
              typeof file === "string" &&
              (file.endsWith(".ts") || file.endsWith(".tsx"))
          )
        ) {
          return "typescript";
        }
        if (
          files.some(
            file =>
              typeof file === "string" &&
              (file.endsWith(".js") || file.endsWith(".jsx"))
          )
        ) {
          return "javascript";
        }
      } catch (error) {
        // Directory might not be readable
      }
    }
  }

  // 4. Default to JavaScript if we can't determine
  return "javascript";
}
