# @sapbruno/cf-btp

SAP Cloud Foundry / BTP credential provider for [`sapbruno`](https://www.npmjs.com/package/sapbruno).

Extracts OAuth2 `client_credentials` from the `xsuaa` (or `identity`) service binding of a deployed
Cloud Foundry app, via the `cf` CLI. Eliminates the need to hand-copy `clientid`/`clientsecret` from
service keys into Bruno env files.

## How it works

For each call to `fetch(prefix, ctx)`, the provider:

1. Resolves `{ group, branch, app }` from the configured `services[prefix]` binding.
2. Looks up the corresponding CF org from a branch → subaccount map file (same JSON format as the
   `branch-btp-subaccount-map.json` used by internal setup scripts).
3. Ensures a live `cf` session — if `cf target` shows no API endpoint or user, it runs
   `cf api <endpoint>` and `cf auth $SAP_EMAIL $SAP_PASSWORD` (or values from provider config).
4. Runs `cf target -o <org> -s <space>`, `cf app <app> --guid`, `cf curl /v3/apps/<guid>/env`.
5. Parses `VCAP_SERVICES.xsuaa[0].credentials` — returns
   `{ tokenUrl: <url> + /oauth/token, clientId, clientSecret }`.

If no `xsuaa` binding exists it falls back to the `identity` service and uses `/oauth2/token`.

## Install

```bash
pnpm add -D @sapbruno/cf-btp sapbruno
```

Requires the `cf` CLI on your PATH.

## Configure

In your `sapbruno.config.json`:

```json
{
  "collections": "./collections",
  "environments": {
    "dev": {
      "auth": { "type": "oauth2-client-credentials" },
      "credentialProvider": {
        "type": "cf-btp",
        "mapFile": "../../../docs/infrastructure/cf/branch-btp-subaccount-map.json",
        "space": "app",
        "cacheTtlSeconds": 300,
        "services": {
          "my_group_demo": {
            "group": "my-group",
            "branch": "main",
            "app": "my-demo-app"
          }
        }
      }
    }
  }
}
```

Then register the provider in your sapbruno setup (see `sapbruno` docs for the provider loader).

`branch-btp-subaccount-map.json` format:

```json
{
  "my-group": [
    { "branch": "main", "cf_org": "my-cf-org", "environment": "dev", "region": "eu20" },
    { "branch": "dev", "cf_org": "my-cf-org-dev", "environment": "dev", "region": "eu20" }
  ]
}
```

## Environment variables

- `SAP_EMAIL`, `SAP_PASSWORD` — used for non-interactive `cf auth` when no live session is found.
  Skip these if you prefer to run `cf login` yourself before invoking sapbruno.

## Per-service options

Each entry under `services[prefix]` accepts:

- `group` _(required)_ — matches a top-level key in `mapFile`.
- `branch` _(required)_ — matches an entry under that group → determines target CF org.
- `app` _(required)_ — the CF app name bound to the xsuaa/identity service.
- `cfSpace` — override the default `space` for this one service.
- `serviceInstanceName` — pick a specific service instance by name when the app has multiple
  bindings of the same type.
- `preferredService` — `"xsuaa"` (default) or `"identity"`.

## Programmatic usage

```ts
import { cfBtpProvider } from "@sapbruno/cf-btp";

const provider = cfBtpProvider({
  mapFile: "./branch-btp-subaccount-map.json",
  space: "app",
  services: {
    my_group_demo: { group: "my-group", branch: "main", app: "my-demo-app" },
  },
});

const creds = await provider.fetch("my_group_demo", { rootDir: process.cwd(), envName: "dev" });
// { tokenUrl, clientId, clientSecret }
```

## Security

- Credentials are only held in memory for the lifetime of the Node process.
- `cacheTtlSeconds` controls how long a given prefix's creds are reused before re-fetching.
- The provider never writes credentials to disk — `sapbruno` does that into its Bruno env file
  (same behavior as the upstream provider interface).

## License

MIT © dongtran
