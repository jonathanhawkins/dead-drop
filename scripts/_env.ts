// Loads .env.local into process.env for standalone scripts (tsx/node).
// Import this FIRST, before any module that reads env at import time.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const txt = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
} catch {
  // no .env.local — rely on the ambient environment
}
