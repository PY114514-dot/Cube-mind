/**
 * build.mjs
 * esbuild 构建脚本：bootstrap.ts 打包为 bundle.js / bundle.css，并构建 Cross worker。
 *
 * 使用：node build.mjs
 */

import * as esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync("./dist")) {
  mkdirSync("./dist");
}

await esbuild.build({
  entryPoints: {
    bundle: "src-frontend/bootstrap.ts",
    "cross-scramble-worker": "src-frontend/core/cross-scramble-worker.ts",
  },
  bundle: true,
  format: "iife",
  outdir: "dist",
  target: ["es2020"],
  sourcemap: true,
  minify: false,
  logLevel: "info",
});

copyFileSync("index.html", "dist/index.html");
const bundleVersion = Date.now();
const distIndex = readFileSync("dist/index.html", "utf8");
writeFileSync("dist/index.html", distIndex.replace(/(bundle\.(?:js|css))"/g, `$1?v=${bundleVersion}"`));

console.log("✓ 前端构建完成 → dist/bundle.js");
console.log("✓ 启动后端: npm run server");
