import { describe, expect, it } from "vitest";

import { extractCredentials, parseAppEnv } from "../src/vcap.js";

describe("vcap.ts", () => {
  it("extracts xsuaa credentials and builds token URL with /oauth/token", () => {
    const env = parseAppEnv({
      system_env_json: {
        VCAP_SERVICES: {
          xsuaa: [
            {
              name: "my-xsuaa",
              label: "xsuaa",
              credentials: {
                url: "https://tenant.authentication.eu20.hana.ondemand.com",
                clientid: "sb-my-app",
                clientsecret: "super-secret",
                uaadomain: "authentication.eu20.hana.ondemand.com",
              },
            },
          ],
        },
      },
      application_env_json: {
        VCAP_APPLICATION: {
          application_uris: ["my-app.cfapps.eu20.hana.ondemand.com"],
        },
      },
    });

    const creds = extractCredentials(env);
    expect(creds.source).toBe("xsuaa");
    expect(creds.tokenUrl).toBe(
      "https://tenant.authentication.eu20.hana.ondemand.com/oauth/token",
    );
    expect(creds.clientId).toBe("sb-my-app");
    expect(creds.clientSecret).toBe("super-secret");
    expect(creds.baseUrl).toBe("https://my-app.cfapps.eu20.hana.ondemand.com");
    expect(creds.serviceInstance).toBe("my-xsuaa");
  });

  it("falls back to identity service when xsuaa not bound and uses /oauth2/token", () => {
    const env = parseAppEnv({
      system_env_json: {
        VCAP_SERVICES: {
          identity: [
            {
              label: "identity",
              credentials: {
                url: "https://tenant.accounts.ondemand.com",
                clientid: "ias-client-id",
                clientsecret: "ias-secret",
              },
            },
          ],
        },
      },
    });

    const creds = extractCredentials(env);
    expect(creds.source).toBe("identity");
    expect(creds.tokenUrl).toBe("https://tenant.accounts.ondemand.com/oauth2/token");
    expect(creds.baseUrl).toBeUndefined();
  });

  it("prefers identity when preferredService = identity and both are bound", () => {
    const env = parseAppEnv({
      system_env_json: {
        VCAP_SERVICES: {
          xsuaa: [
            {
              credentials: { url: "https://x.example.com", clientid: "x", clientsecret: "xs" },
            },
          ],
          identity: [
            {
              credentials: { url: "https://i.example.com", clientid: "i", clientsecret: "is" },
            },
          ],
        },
      },
    });
    const creds = extractCredentials(env, { preferredService: "identity" });
    expect(creds.source).toBe("identity");
    expect(creds.clientId).toBe("i");
  });

  it("selects named xsuaa instance when multiple are bound", () => {
    const env = parseAppEnv({
      system_env_json: {
        VCAP_SERVICES: {
          xsuaa: [
            {
              name: "broker-auth",
              credentials: { url: "https://b.example.com", clientid: "b", clientsecret: "bs" },
            },
            {
              name: "app-auth",
              credentials: { url: "https://a.example.com", clientid: "a", clientsecret: "as" },
            },
          ],
        },
      },
    });
    const creds = extractCredentials(env, { serviceInstanceName: "app-auth" });
    expect(creds.clientId).toBe("a");
    expect(creds.serviceInstance).toBe("app-auth");
  });

  it("throws when no xsuaa or identity binding present", () => {
    const env = parseAppEnv({
      system_env_json: {
        VCAP_SERVICES: {
          postgresql: [{ credentials: { url: "postgres://..." } }],
        },
      },
    });
    expect(() => extractCredentials(env)).toThrowError(/No xsuaa or identity service/);
  });

  it("strips trailing slash from UAA url before appending token path", () => {
    const env = parseAppEnv({
      system_env_json: {
        VCAP_SERVICES: {
          xsuaa: [
            {
              credentials: {
                url: "https://tenant.authentication.eu20.hana.ondemand.com/",
                clientid: "c",
                clientsecret: "s",
              },
            },
          ],
        },
      },
    });
    const creds = extractCredentials(env);
    expect(creds.tokenUrl).toBe(
      "https://tenant.authentication.eu20.hana.ondemand.com/oauth/token",
    );
  });

  it("prepends https:// to application_uris when scheme missing", () => {
    const env = parseAppEnv({
      application_env_json: {
        VCAP_APPLICATION: { application_uris: ["svc.cfapps.eu20.hana.ondemand.com"] },
      },
      system_env_json: {
        VCAP_SERVICES: {
          xsuaa: [
            {
              credentials: { url: "https://u.example.com", clientid: "c", clientsecret: "s" },
            },
          ],
        },
      },
    });
    const creds = extractCredentials(env);
    expect(creds.baseUrl).toBe("https://svc.cfapps.eu20.hana.ondemand.com");
  });

  it("preserves http:// scheme when application_uris has explicit scheme", () => {
    const env = parseAppEnv({
      application_env_json: {
        VCAP_APPLICATION: { application_uris: ["http://localhost:4004"] },
      },
      system_env_json: {
        VCAP_SERVICES: {
          xsuaa: [
            {
              credentials: { url: "https://u.example.com", clientid: "c", clientsecret: "s" },
            },
          ],
        },
      },
    });
    const creds = extractCredentials(env);
    expect(creds.baseUrl).toBe("http://localhost:4004");
  });
});
