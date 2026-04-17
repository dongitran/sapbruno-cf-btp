import { z } from "zod";

const xsuaaCredentialsSchema = z.object({
  url: z.string(),
  clientid: z.string(),
  clientsecret: z.string(),
  uaadomain: z.string().optional(),
  xsappname: z.string().optional(),
  identityzone: z.string().optional(),
});

const iasCredentialsSchema = z.object({
  url: z.string(),
  clientid: z.string(),
  clientsecret: z.string(),
});

const vcapServiceInstanceSchema = z
  .object({
    name: z.string().optional(),
    label: z.string().optional(),
    plan: z.string().optional(),
    tags: z.array(z.string()).optional(),
    credentials: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const vcapServicesSchema = z.record(z.string(), z.array(vcapServiceInstanceSchema));

const vcapApplicationSchema = z
  .object({
    application_uris: z.array(z.string()).optional(),
    application_name: z.string().optional(),
  })
  .passthrough();

const appEnvSchema = z.object({
  staging_env_json: z.record(z.string(), z.unknown()).optional(),
  running_env_json: z.record(z.string(), z.unknown()).optional(),
  environment_variables: z.record(z.string(), z.unknown()).optional(),
  application_env_json: z
    .object({
      VCAP_APPLICATION: vcapApplicationSchema.optional(),
    })
    .passthrough()
    .optional(),
  system_env_json: z
    .object({
      VCAP_SERVICES: vcapServicesSchema.optional(),
    })
    .passthrough()
    .optional(),
});

export type AppEnv = z.infer<typeof appEnvSchema>;
export type VcapServices = z.infer<typeof vcapServicesSchema>;
export type VcapApplication = z.infer<typeof vcapApplicationSchema>;

export function parseAppEnv(raw: unknown): AppEnv {
  return appEnvSchema.parse(raw);
}

export interface ExtractedCredentials {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  source: "xsuaa" | "identity";
  serviceInstance?: string;
}

export interface ExtractOptions {
  preferredService?: "xsuaa" | "identity";
  serviceInstanceName?: string;
}

export function extractCredentials(env: AppEnv, opts: ExtractOptions = {}): ExtractedCredentials {
  const services = env.system_env_json?.VCAP_SERVICES ?? {};
  const baseUrl = pickBaseUrl(env.application_env_json?.VCAP_APPLICATION);

  const searchOrder: ("xsuaa" | "identity")[] =
    opts.preferredService === "identity" ? ["identity", "xsuaa"] : ["xsuaa", "identity"];

  for (const kind of searchOrder) {
    const instances = services[kind];
    if (!instances || instances.length === 0) continue;

    const chosen = opts.serviceInstanceName
      ? instances.find((i) => i.name === opts.serviceInstanceName)
      : instances[0];
    if (!chosen?.credentials) continue;

    const parsed =
      kind === "xsuaa"
        ? xsuaaCredentialsSchema.safeParse(chosen.credentials)
        : iasCredentialsSchema.safeParse(chosen.credentials);
    if (!parsed.success) continue;

    const tokenPath = kind === "xsuaa" ? "/oauth/token" : "/oauth2/token";
    return {
      tokenUrl: stripTrailingSlash(parsed.data.url) + tokenPath,
      clientId: parsed.data.clientid,
      clientSecret: parsed.data.clientsecret,
      ...(baseUrl !== undefined && { baseUrl }),
      source: kind,
      ...(chosen.name !== undefined && { serviceInstance: chosen.name }),
    };
  }

  const available = Object.keys(services);
  throw new Error(
    `No xsuaa or identity service binding found in VCAP_SERVICES. Available services: ${available.length > 0 ? available.join(", ") : "<none>"}`,
  );
}

function pickBaseUrl(app: VcapApplication | undefined): string | undefined {
  const uri = app?.application_uris?.[0];
  if (!uri) return undefined;
  return uri.startsWith("http://") || uri.startsWith("https://") ? uri : `https://${uri}`;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
