/**
 * ui/cube-geometry.ts
 * 小方块（cubie）DOM 几何辅助：坐标读写、面片渲染、facelet 下标换算与转层判定。
 *
 * 拆自 cube-visualizer.ts（P1 技术债）：这些函数只操作单个 cubie 的
 * DOM/坐标，不持有全局状态，供 CubeDomRenderer 复用。
 */

import { FACE_ORDER, type CubiePosition } from "./cube-view-rotation.ts";

export function getCubiePosition(cubie: HTMLElement): CubiePosition {
  return {
    x: Number(cubie.dataset.x ?? "0"),
    y: Number(cubie.dataset.y ?? "0"),
    z: Number(cubie.dataset.z ?? "0"),
  };
}

export function setCubiePosition(cubie: HTMLElement, position: CubiePosition): void {
  cubie.dataset.x = String(position.x);
  cubie.dataset.y = String(position.y);
  cubie.dataset.z = String(position.z);
  cubie.style.transform = `translate3d(${position.x * 50}px, ${position.y * 50}px, ${position.z * 50}px)`;
}

export function renderCubieFaces(cubie: HTMLElement, position: CubiePosition): void {
  cubie.replaceChildren();
  const visibleFaces = new Set(getCubieFaces(position.x, position.y, position.z));
  // 参考 cubing.js 的 cubie foundation：每个外露面都有连续的黑色实体底座，
  // 圆角外框与贴纸仅作为上层装饰，不再依赖会干扰转层的全局外壳。
  for (const face of visibleFaces) {
    const foundation = document.createElement("div");
    foundation.className = `cube-cubie-foundation-face cube-cubie-foundation-face-${face.toLowerCase()}`;
    cubie.appendChild(foundation);
  }
  // 每颗小方块保留完整的黑色塑料本体；只有朝外的面才装贴纸。
  // 这样从转层缝隙或相邻块之间看进去时，不会透出同一颗块背面的彩色贴纸。
  for (const face of FACE_ORDER) {
    const faceElement = document.createElement("div");
    faceElement.className = `cube-cubie-face cube-cubie-face-${face.toLowerCase()}`;
    if (!visibleFaces.has(face)) {
      faceElement.classList.add("cube-cubie-face-inner");
      cubie.appendChild(faceElement);
      continue;
    }
    // 中心盖与普通色块完全一致：无圆盖缝、无品牌位（2026-08-20 用户要求删除圆环）。
    const sticker = document.createElement("span");
    sticker.className = "cube-sticker";
    sticker.dataset.face = face;
    sticker.title = `${face}${getFaceletIndex(face, position.x, position.y, position.z) % 9}`;
    faceElement.appendChild(sticker);
    cubie.appendChild(faceElement);
  }
}

function getCubieFaces(x: number, y: number, z: number): string[] {
  const faces: string[] = [];
  if (y === -1) faces.push("U");
  if (x === 1) faces.push("R");
  if (z === 1) faces.push("F");
  if (y === 1) faces.push("D");
  if (x === -1) faces.push("L");
  if (z === -1) faces.push("B");
  return faces;
}

export function getFaceletIndex(face: string, x: number, y: number, z: number): number {
  const row = y + 1;
  const col = x + 1;
  if (face === "U") return (z + 1) * 3 + col;
  if (face === "R") return 9 + row * 3 + (1 - z);
  if (face === "F") return 18 + row * 3 + col;
  if (face === "D") return 27 + (1 - z) * 3 + col;
  if (face === "L") return 36 + row * 3 + (z + 1);
  return 45 + row * 3 + (1 - x);
}

export function isCubieInFaceLayer(cubie: HTMLElement, face: string): boolean {
  const x = Number(cubie.dataset.x);
  const y = Number(cubie.dataset.y);
  const z = Number(cubie.dataset.z);
  if (face === "U") return y === -1;
  if (face === "D") return y === 1;
  if (face === "R") return x === 1;
  if (face === "L") return x === -1;
  if (face === "F") return z === 1;
  return z === -1;
}

export function getLayerRotation(face: string, degrees: number): string {
  if (face === "U") return `rotateY(${-degrees}deg)`;
  if (face === "D") return `rotateY(${degrees}deg)`;
  if (face === "R") return `rotateX(${degrees}deg)`;
  if (face === "L") return `rotateX(${-degrees}deg)`;
  if (face === "F") return `rotateZ(${degrees}deg)`;
  return `rotateZ(${-degrees}deg)`;
}
