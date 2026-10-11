import {
  CUBE_COLORS,
  CUBE_FACES,
  createEmptyCubeEditorState,
  createSolvedCubeEditorState,
  getPaintedStickerCount,
  setCubeSticker,
  toFaceletString,
  toVisualizerFacelets,
  type CubeColor,
  type CubeEditorState,
  type CubeSticker,
} from "../core/cube-editor-state.ts";
import { CubeVisualizer } from "../ui/cube-visualizer.ts";

export interface CubeEditorControllerElements {
  cubeEditorPreview: HTMLDivElement;
  cubeEditorPalette: HTMLDivElement;
  cubeEditorStatus: HTMLElement;
  cubeAgentPrompt: HTMLTextAreaElement;
  btnCubeEditorReset: HTMLButtonElement;
  btnCubeEditorSolved: HTMLButtonElement;
  btnAskCubeAgent: HTMLButtonElement;
}

export interface CubeEditorControllerOptions {
  elements: CubeEditorControllerElements;
  onAsk: (message: string, facelets: string, complete: boolean) => void;
}

const COLOR_LABELS: Record<CubeColor, string> = { W: "白", R: "红", G: "绿", Y: "黄", O: "橙", B: "蓝" };

/** AI 对话框中的贴纸录入器；只负责采集状态，不在浏览器内臆测解法。 */
export class CubeEditorController {
  private state: CubeEditorState = createEmptyCubeEditorState();
  private selectedColor: CubeSticker = "W";
  private preview: CubeVisualizer | null = null;

  constructor(private readonly options: CubeEditorControllerOptions) {}

  init(): void {
    const { elements } = this.options;
    elements.cubeEditorPalette.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLButtonElement ? event.target : null;
      if (!target?.dataset.cubeColor) return;
      this.selectedColor = target.dataset.cubeColor === "clear" ? null : target.dataset.cubeColor as CubeColor;
      this.render();
    });
    this.preview = new CubeVisualizer(elements.cubeEditorPreview, {
      role: "editor",
      interactive: true,
      initialRotationX: -24,
      initialRotationY: -36,
      onStickerClick: (faceletIndex) => {
        const face = CUBE_FACES[Math.floor(faceletIndex / 9)];
        const index = faceletIndex % 9;
        if (!face || index === 4) return;
        this.state = setCubeSticker(this.state, face, index, this.selectedColor);
        this.render();
      },
    });
    elements.btnCubeEditorReset.onclick = () => { this.state = createEmptyCubeEditorState(); this.render(); };
    elements.btnCubeEditorSolved.onclick = () => { this.state = createSolvedCubeEditorState(); this.render(); };
    elements.btnAskCubeAgent.onclick = () => {
      const painted = getPaintedStickerCount(this.state);
      const complete = painted === 54;
      this.options.onAsk(elements.cubeAgentPrompt.value.trim(), toFaceletString(this.state), complete);
    };
    this.render();
  }

  private render(): void {
    const { elements } = this.options;
    elements.cubeEditorPalette.innerHTML = [
      ...CUBE_COLORS.map((color) => `<button type="button" class="cube-palette-color ${this.selectedColor === color ? "selected" : ""}" data-cube-color="${color}" data-color="${color}" aria-label="选择${COLOR_LABELS[color]}色"></button>`),
      `<button type="button" class="cube-palette-clear ${this.selectedColor === null ? "selected" : ""}" data-cube-color="clear">擦除</button>`,
    ].join("");
    this.preview?.setFacelets(toVisualizerFacelets(this.state));
    const painted = getPaintedStickerCount(this.state);
    elements.cubeEditorStatus.textContent = painted === 54 ? "局面已填满，可以校验颜色、朝向与可达性。" : `已涂 ${painted}/54 格；中心色已固定，未涂部分保持黑色。`;
  }
}
