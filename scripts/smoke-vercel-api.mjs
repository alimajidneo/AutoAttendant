import { readFile } from "node:fs/promises";

const bundleUrl = new URL("../.vercel-build/api.mjs", import.meta.url);
const bundle = await readFile(bundleUrl, "utf8");
if (!bundle.includes("BEGIN CERTIFICATE")) {
  throw new Error("Generated Vercel API does not embed the Supabase CA certificate");
}
const { default: app } = await import(new URL(`${bundleUrl.href}?smoke=${Date.now()}`));

if (typeof app?.request !== "function") {
  throw new Error("Generated Vercel API does not export a Hono application");
}

const health = await app.request("http://local/api/health");
const healthBody = await health.json();
if (health.status !== 200 || healthBody?.status !== "ok") {
  throw new Error(`Generated Vercel API health failed with status ${health.status}`);
}

const unsigned = await app.request("http://local/api/retell/functions/lookup-employee", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ call: { agent_id: "agent", call_id: "call" }, args: {} }),
});
if (unsigned.status !== 401) {
  throw new Error(`Unsigned Retell request returned ${unsigned.status} instead of 401`);
}

console.log("vercel_api_smoke=ok health=200 unsigned_retell=401");
