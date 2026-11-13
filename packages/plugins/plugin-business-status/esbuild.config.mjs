import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const externalUi = [
  "@paperclipai/plugin-sdk/ui",
  "@paperclipai/plugin-sdk/ui/hooks",
  "react",
  "react-dom",
  "react/jsx-runtime",
];

const worker = {
  entryPoints: ["src/worker.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: false,
  external: ["@paperclipai/plugin-sdk", "react", "react-dom"],
};

const manifest = {
  entryPoints: ["src/manifest.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: false,
  external: ["@paperclipai/plugin-sdk"],
};

const profile = {
  entryPoints: ["src/profile.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: false,
};

const logic = {
  entryPoints: ["src/logic.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: false,
};

const ui = {
  entryPoints: ["src/ui/index.tsx"],
  outdir: "dist/ui",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  external: externalUi,
};

const workerCtx = await esbuild.context(worker);
const manifestCtx = await esbuild.context(manifest);
const uiCtx = await esbuild.context(ui);
const logicCtx = await esbuild.context(logic);
const profileCtx = await esbuild.context(profile);

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch(), logicCtx.watch(), profileCtx.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, and ui");
} else {
  await Promise.all([workerCtx.rebuild(), manifestCtx.rebuild(), uiCtx.rebuild(), logicCtx.rebuild(), profileCtx.rebuild()]);
  await Promise.all([workerCtx.dispose(), manifestCtx.dispose(), uiCtx.dispose(), logicCtx.dispose(), profileCtx.dispose()]);
  console.log("built dist/manifest.js, dist/worker.js, dist/ui/index.js");
}



