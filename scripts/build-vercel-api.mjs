import { mkdir, readFile, rm } from "node:fs/promises";
import { build } from "esbuild";

const outputDirectory = new URL("../.vercel-build/", import.meta.url);
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const supabaseCa = await readFile(new URL("../packages/core/src/db/certs/supabase-prod-ca-2021.crt", import.meta.url), "utf8");
if (!supabaseCa.includes("BEGIN CERTIFICATE")) throw new Error("Supabase CA certificate is invalid");

await build({
  entryPoints: [new URL("../serverless/index.ts", import.meta.url).pathname],
  outfile: new URL("api.mjs", outputDirectory).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: "import { createRequire as __deskrouteCreateRequire } from 'node:module'; const require = __deskrouteCreateRequire(import.meta.url);",
  },
  alias: {
    "@receptionist/core": new URL("../packages/core/src", import.meta.url).pathname,
    "@receptionist/shared": new URL("../packages/shared/src", import.meta.url).pathname,
  },
  external: ["pg-native"],
  define: { __DESKROUTE_SUPABASE_CA__: JSON.stringify(supabaseCa) },
  legalComments: "none",
  logLevel: "info",
});
