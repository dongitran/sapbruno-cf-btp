import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cfBtpProvider } from "../src/index.js";

import type * as cfModuleNs from "../src/cf.js";
import type { CfRunner } from "../src/cf.js";

vi.mock("../src/cf.js", async () => {
  const actual = await vi.importActual<typeof cfModuleNs>("../src/cf.js");
  return {
    ...actual,
    createCfRunner: vi.fn(),
  };
});

const { createCfRunner } = await import("../src/cf.js");

function makeCfMock(
  handlers: Record<string, () => { stdout: string; exitCode?: number }>,
): CfRunner {
  return {
    exec: vi.fn((args: string[]) => {
      const key = args.join(" ");
      for (const [pattern, fn] of Object.entries(handlers)) {
        if (key === pattern || key.startsWith(`${pattern} `)) {
          const r = fn();
          return Promise.resolve({ stdout: r.stdout, stderr: "", exitCode: r.exitCode ?? 0 });
        }
      }
      return Promise.resolve({ stdout: "", stderr: `unmatched: ${key}`, exitCode: 1 });
    }),
  };
}

describe("cfBtpProvider", () => {
  let dir: string;
  let mapPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cf-btp-provider-"));
    mapPath = join(dir, "branch-map.json");
    await writeFile(
      mapPath,
      JSON.stringify({
        "my-group": [{ branch: "main", cf_org: "my-cf-org", environment: "dev", region: "eu20" }],
      }),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.resetAllMocks();
  });

  it("resolves credentials via cf CLI sequence for a bound prefix", async () => {
    const appEnv = {
      application_env_json: {
        VCAP_APPLICATION: { application_uris: ["demo.cfapps.eu20.hana.ondemand.com"] },
      },
      system_env_json: {
        VCAP_SERVICES: {
          xsuaa: [
            {
              name: "demo-xsuaa",
              credentials: {
                url: "https://tenant.authentication.eu20.hana.ondemand.com",
                clientid: "sb-demo",
                clientsecret: "top-secret",
              },
            },
          ],
        },
      },
    };

    const cfMock = makeCfMock({
      target: () => ({
        stdout: "API endpoint: https://api.cf.eu20.hana.ondemand.com\nUser: me@co.com\n",
      }),
      api: () => ({ stdout: "OK" }),
      "target -o my-cf-org -s app": () => ({ stdout: "OK" }),
      "app my-demo-app --guid": () => ({ stdout: "GUID-123\n" }),
      "curl /v3/apps/GUID-123/env": () => ({ stdout: JSON.stringify(appEnv) }),
    });
    vi.mocked(createCfRunner).mockReturnValue(cfMock);

    const provider = cfBtpProvider({
      mapFile: mapPath,
      space: "app",
      services: {
        my_group_demo: {
          group: "my-group",
          branch: "main",
          app: "my-demo-app",
        },
      },
    });

    const creds = await provider.fetch("my_group_demo", {
      rootDir: dir,
      envName: "dev",
    });
    expect(creds).toEqual({
      tokenUrl: "https://tenant.authentication.eu20.hana.ondemand.com/oauth/token",
      clientId: "sb-demo",
      clientSecret: "top-secret",
    });
  });

  it("throws a helpful error when prefix has no binding", async () => {
    vi.mocked(createCfRunner).mockReturnValue(makeCfMock({}));
    const provider = cfBtpProvider({ mapFile: mapPath, services: {} });
    await expect(
      provider.fetch("unknown_prefix", { rootDir: dir, envName: "dev" }),
    ).rejects.toThrow(/no service binding configured for prefix 'unknown_prefix'/);
  });

  it("throws when branch not in map", async () => {
    vi.mocked(createCfRunner).mockReturnValue(
      makeCfMock({
        target: () => ({
          stdout: "API endpoint: https://api.cf.eu20.hana.ondemand.com\nUser: me@co.com\n",
        }),
      }),
    );
    const provider = cfBtpProvider({
      mapFile: mapPath,
      services: {
        p: { group: "my-group", branch: "nope", app: "a-x" },
      },
    });
    await expect(provider.fetch("p", { rootDir: dir, envName: "dev" })).rejects.toThrow(
      /no entry for group='my-group' branch='nope'/,
    );
  });

  it("caches credentials for ttl window", async () => {
    const appEnv = {
      system_env_json: {
        VCAP_SERVICES: {
          xsuaa: [
            {
              credentials: {
                url: "https://u.example.com",
                clientid: "c",
                clientsecret: "s",
              },
            },
          ],
        },
      },
    };
    let curlCalls = 0;
    const cfMock: CfRunner = {
      exec: vi.fn((args: string[]) => {
        const key = args.join(" ");
        if (key.startsWith("target -o"))
          return Promise.resolve({ stdout: "OK", stderr: "", exitCode: 0 });
        if (key === "target")
          return Promise.resolve({
            stdout: "API endpoint: https://api.cf.eu20.hana.ondemand.com\nUser: me@co.com\n",
            stderr: "",
            exitCode: 0,
          });
        if (key.startsWith("api"))
          return Promise.resolve({ stdout: "OK", stderr: "", exitCode: 0 });
        if (key.startsWith("app "))
          return Promise.resolve({ stdout: "G\n", stderr: "", exitCode: 0 });
        if (key.startsWith("curl")) {
          curlCalls++;
          return Promise.resolve({ stdout: JSON.stringify(appEnv), stderr: "", exitCode: 0 });
        }
        return Promise.resolve({ stdout: "", stderr: "x", exitCode: 1 });
      }),
    };
    vi.mocked(createCfRunner).mockReturnValue(cfMock);

    const provider = cfBtpProvider({
      mapFile: mapPath,
      services: { p: { group: "my-group", branch: "main", app: "a" } },
      cacheTtlSeconds: 60,
    });

    await provider.fetch("p", { rootDir: dir, envName: "dev" });
    await provider.fetch("p", { rootDir: dir, envName: "dev" });
    expect(curlCalls).toBe(1);
  });
});
