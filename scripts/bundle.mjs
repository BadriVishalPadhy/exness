// Bundles one backend app (with @strata/shared inlined) into apps/<name>/dist/index.js.
import { build } from "esbuild";
const name = process.argv[2];
await build({
  entryPoints: [`src/index.ts`],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  minify: false,
  external: ["pg-native"],
  logLevel: "info",
});
console.log(`bundled ${name}`);
