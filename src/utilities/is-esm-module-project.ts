import * as path from "path";
import * as fs from "fs-extra";

/**
 * Check if the project uses ES modules by looking at package.json
 */
export function isESModuleProject(projectRoot: string): boolean {
  try {
    const packageJsonPath = path.join(projectRoot, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      return packageJson.type === "module";
    }
    return false;
  } catch {
    return false;
  }
}
