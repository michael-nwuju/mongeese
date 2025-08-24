import * as fs from "fs-extra";
import { isESModuleProject } from "./is-esm-module-project";

const JS_BOOTSTRAP_FILE = "mongeese.connection.js";
const CJS_BOOTSTRAP_FILE = "mongeese.connection.cjs";
const TS_BOOTSTRAP_FILE = "mongeese.connection.ts";

export async function getBootstrapFile() {
  let bootstrapFile: string = "";

  const isESProject = isESModuleProject(process.cwd());

  // Check for files in order of preference
  // For ES module projects, prefer .cjs files for better compatibility
  if (isESProject && fs.existsSync(CJS_BOOTSTRAP_FILE)) {
    bootstrapFile = CJS_BOOTSTRAP_FILE;
  }
  // Standard JavaScript file
  else if (fs.existsSync(JS_BOOTSTRAP_FILE)) {
    bootstrapFile = JS_BOOTSTRAP_FILE;
  }
  // TypeScript file
  else if (fs.existsSync(TS_BOOTSTRAP_FILE)) {
    bootstrapFile = TS_BOOTSTRAP_FILE;
  }

  return bootstrapFile;
}
