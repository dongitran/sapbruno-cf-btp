import { readFile } from "node:fs/promises";

import { z } from "zod";

const mapEntrySchema = z.object({
  branch: z.string(),
  cf_org: z.string(),
  environment: z.string().optional(),
  region: z.string().optional(),
});

const mapFileSchema = z.record(z.string(), z.array(mapEntrySchema));

export type BranchMapEntry = z.infer<typeof mapEntrySchema>;
export type BranchMap = z.infer<typeof mapFileSchema>;

export async function readBranchMap(path: string): Promise<BranchMap> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return mapFileSchema.parse(parsed);
}

export function findEntry(
  map: BranchMap,
  group: string,
  branch: string,
): BranchMapEntry | undefined {
  return map[group]?.find((e) => e.branch === branch);
}

export function cfApiFromRegion(region: string | undefined): string {
  const r = region ?? "br10";
  return `https://api.cf.${r}.hana.ondemand.com`;
}
