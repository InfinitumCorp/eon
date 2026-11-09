import { fileURLToPath } from "node:url";

/** Repository root, from this module's place in src/lib/eon. */
export function repoRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}
