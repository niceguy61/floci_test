import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function readAuthRuntime() {
  const runtimeFile = path.resolve(__dirname, "../.runtime/cognito.json");
  const content = await readFile(runtimeFile, "utf8");
  return JSON.parse(content);
}
