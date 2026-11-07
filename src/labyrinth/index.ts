import { createLabyrinthClient } from "./client.ts";
import type { LabyrinthClientOptions } from "./client.ts";
export { proxyLabyrinthRequest } from "./proxy.ts";
export type { LabyrinthClientOptions } from "./client.ts";
/** Real Cumulus ID token required; static product/Access credentials are not client identities. */
export const createEonLabyrinth = (options: LabyrinthClientOptions) => createLabyrinthClient("eon", options);
