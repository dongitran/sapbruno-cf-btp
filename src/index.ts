import { isAbsolute, resolve } from "node:path";

import { z } from "zod";

import {
  cfApi,
  cfAppGuid,
  cfAuth,
  cfCurl,
  cfSetTarget,
  cfTarget,
  createCfRunner,
} from "./cf.js";
import { log } from "./logger.js";
import { type BranchMap, cfApiFromRegion, findEntry, readBranchMap } from "./map.js";
import { type ExtractedCredentials, extractCredentials, parseAppEnv } from "./vcap.js";

import type { CredentialProvider, OAuthCredentials, ProviderContext } from "sapbruno";

export type { BranchMap, BranchMapEntry } from "./map.js";
export type { AppEnv, VcapServices, ExtractedCredentials, ExtractOptions } from "./vcap.js";
export { extractCredentials, parseAppEnv } from "./vcap.js";
export { readBranchMap, findEntry, cfApiFromRegion } from "./map.js";
export {
  createCfRunner,
  cfApi,
  cfAuth,
  cfSetTarget,
  cfAppGuid,
  cfCurl,
  cfTarget,
} from "./cf.js";
export type { CfRunner, CfExecResult, CfRunnerOptions } from "./cf.js";

const serviceBindingSchema = z.object({
  group: z.string(),
  branch: z.string(),
  app: z.string(),
  cfSpace: z.string().optional(),
  serviceInstanceName: z.string().optional(),
  preferredService: z.enum(["xsuaa", "identity"]).optional(),
});

export type ServiceBinding = z.infer<typeof serviceBindingSchema>;

const configSchema = z.object({
  mapFile: z.string(),
  space: z.string().default("app"),
  services: z.record(z.string(), serviceBindingSchema).default({}),
  email: z.string().optional(),
  password: z.string().optional(),
  cacheTtlSeconds: z.number().int().nonnegative().optional(),
});

export type CfBtpProviderConfig = z.input<typeof configSchema>;

interface CacheEntry {
  creds: ExtractedCredentials;
  expiresAt: number;
}

export function cfBtpProvider(rawConfig: CfBtpProviderConfig): CredentialProvider {
  const config = configSchema.parse(rawConfig);
  const cf = createCfRunner();
  const cache = new Map<string, CacheEntry>();
  const ttlMs = (config.cacheTtlSeconds ?? 0) * 1000;

  let loginEnsured = false;

  async function ensureLogin(endpoint: string): Promise<void> {
    if (loginEnsured) return;

    const current = await cfTarget(cf);
    const apiLine = current?.match(/API endpoint:\s*(\S+)/)?.[1]?.trim();
    const userLine = current?.match(/User:\s*(\S+)/)?.[1]?.trim();

    if (apiLine !== endpoint) {
      log.info(`cf api ${endpoint}`);
      await cfApi(cf, endpoint);
    }

    if (!userLine || apiLine !== endpoint) {
      const email = config.email ?? process.env["SAP_EMAIL"];
      const password = config.password ?? process.env["SAP_PASSWORD"];
      if (!email || !password) {
        throw new Error(
          "cf-btp: not logged in and SAP_EMAIL / SAP_PASSWORD env vars not set. " +
            "Either run 'cf login' manually before invoking sapbruno, or set both env vars.",
        );
      }
      log.info(`cf auth ${email}`);
      await cfAuth(cf, email, password);
    }

    loginEnsured = true;
  }

  return {
    type: "cf-btp",
    fetch: async (prefix, ctx: ProviderContext): Promise<OAuthCredentials> => {
      const cached = cache.get(prefix);
      if (cached && cached.expiresAt > Date.now()) {
        return toOAuth(cached.creds);
      }

      const binding = config.services[prefix];
      if (!binding) {
        throw new Error(
          `cf-btp: no service binding configured for prefix '${prefix}'. ` +
            `Add it under credentialProvider.services.${prefix} in sapbruno.config.json.`,
        );
      }

      const mapPath = isAbsolute(config.mapFile)
        ? config.mapFile
        : resolve(ctx.rootDir, config.mapFile);
      const map: BranchMap = await readBranchMap(mapPath);
      const entry = findEntry(map, binding.group, binding.branch);
      if (!entry) {
        const available = (map[binding.group] ?? []).map((e) => e.branch).join(", ") || "<none>";
        throw new Error(
          `cf-btp: no entry for group='${binding.group}' branch='${binding.branch}' in ${mapPath}. Available branches for this group: ${available}`,
        );
      }

      const endpoint = cfApiFromRegion(entry.region);
      await ensureLogin(endpoint);

      log.info(`cf target -o ${entry.cf_org} -s ${binding.cfSpace ?? config.space}`);
      await cfSetTarget(cf, entry.cf_org, binding.cfSpace ?? config.space);

      log.info(`cf app ${binding.app} --guid`);
      const guid = await cfAppGuid(cf, binding.app);

      log.info(`cf curl /v3/apps/${guid}/env`);
      const raw = await cfCurl(cf, `/v3/apps/${guid}/env`);
      const env = parseAppEnv(raw);
      const extracted = extractCredentials(env, {
        ...(binding.preferredService !== undefined && {
          preferredService: binding.preferredService,
        }),
        ...(binding.serviceInstanceName !== undefined && {
          serviceInstanceName: binding.serviceInstanceName,
        }),
      });

      log.success(
        `Extracted ${extracted.source} credentials for ${prefix} (${extracted.serviceInstance ?? "<unnamed>"})`,
      );

      if (ttlMs > 0) {
        cache.set(prefix, { creds: extracted, expiresAt: Date.now() + ttlMs });
      }

      return toOAuth(extracted);
    },
  };
}

function toOAuth(c: ExtractedCredentials): OAuthCredentials {
  return {
    tokenUrl: c.tokenUrl,
    clientId: c.clientId,
    clientSecret: c.clientSecret,
  };
}
