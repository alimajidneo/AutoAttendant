// The TypeScript application is bundled during `pnpm build` so Vercel never
// ships raw TypeScript from internal workspace packages to the Node runtime.
export { default } from "../.vercel-build/api.mjs";
