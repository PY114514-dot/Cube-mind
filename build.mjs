/**
 * build.mjs
 * esbuild 构建脚本：将 src-frontend/main.ts 打包为 dist/bundle.js
 *
 * 使用：node build.mjs
 */

import * as esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

if (!existsSync("./dist")) {
  mkdirSync("./dist");
}

await esbuild.build({
  entryPoints: ["src-frontend/bootstrap.ts"],
  bundle: true,
  format: "iife",
  outfile: "dist/bundle.js",
  target: ["es2020"],
  sourcemap: true,
  minify: false,
  logLevel: "info",
});

copyFileSync("index.html", "dist/index.html");

console.log("✓ 前端构建完成 → dist/bundle.js");
console.log("✓ 启动后端: npm run server");
