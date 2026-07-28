/**
 * src-frontend/utils/lzstring.ts
 * LZString 包装（使用 npm 包）
 *
 * cstimer 用的就是 lz-string v1.4.4，我们直接用 npm 包
 */

import LZString from "lz-string";

export function decompressFromEncodedURIComponent(input: string): string {
  return LZString.decompressFromEncodedURIComponent(input) || "";
}