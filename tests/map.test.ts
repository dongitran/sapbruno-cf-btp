import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cfApiFromRegion, findEntry, readBranchMap } from "../src/map.js";

describe("map.ts", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cf-btp-map-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads and parses a branch map file", async () => {
    const file = join(dir, "map.json");
    await writeFile(
      file,
      JSON.stringify({
        "my-group": [
          { branch: "main", cf_org: "my-cf-org", environment: "dev", region: "eu20" },
          { branch: "dev", cf_org: "my-cf-org-dev", environment: "dev" },
        ],
      }),
    );

    const map = await readBranchMap(file);
    expect(map["my-group"]).toHaveLength(2);
    expect(map["my-group"]?.[0]?.cf_org).toBe("my-cf-org");
  });

  it("findEntry returns matching branch or undefined", () => {
    const map = {
      "my-group": [
        { branch: "main", cf_org: "my-cf-org" },
        { branch: "dev", cf_org: "my-cf-org-dev" },
      ],
    };
    expect(findEntry(map, "my-group", "main")?.cf_org).toBe("my-cf-org");
    expect(findEntry(map, "my-group", "missing")).toBeUndefined();
    expect(findEntry(map, "unknown-group", "main")).toBeUndefined();
  });

  it("cfApiFromRegion builds the BTP API endpoint", () => {
    expect(cfApiFromRegion("eu20")).toBe("https://api.cf.eu20.hana.ondemand.com");
    expect(cfApiFromRegion(undefined)).toBe("https://api.cf.br10.hana.ondemand.com");
  });

  it("rejects invalid map files", async () => {
    const file = join(dir, "bad.json");
    await writeFile(file, JSON.stringify({ group: [{ branch: 123 }] }));
    await expect(readBranchMap(file)).rejects.toThrow();
  });
});
