export interface CubeViewActions {
  reset: () => void;
  zoom: (delta: number) => void;
  rotate: (pitch: number, yaw: number) => void;
}

/** 视角控制只改变观察角度，不触碰实体局面、计时或陀螺仪基准。 */
export function bindCubeViewControls(root: HTMLElement, actions: CubeViewActions): void {
  root.tabIndex = 0;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "三维魔方。拖动或方向键旋转，加减键缩放，Home 键复位视角。");
  const controls = document.createElement("div");
  controls.className = "cube-view-controls";
  const buttons = [
    { label: "缩小魔方", text: "−", run: () => actions.zoom(-0.1) },
    { label: "复位视角", text: "复位视角", run: actions.reset },
    { label: "放大魔方", text: "+", run: () => actions.zoom(0.1) },
  ];
  for (const action of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost";
    button.textContent = action.text;
    button.setAttribute("aria-label", action.label);
    button.addEventListener("click", action.run);
    controls.appendChild(button);
  }
  root.appendChild(controls);
  root.addEventListener("keydown", (event) => {
    if (event.target !== root || event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case "ArrowLeft": actions.rotate(0, -15); break;
      case "ArrowRight": actions.rotate(0, 15); break;
      case "ArrowUp": actions.rotate(15, 0); break;
      case "ArrowDown": actions.rotate(-15, 0); break;
      case "+": case "=": actions.zoom(0.1); break;
      case "-": actions.zoom(-0.1); break;
      case "Home": actions.reset(); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
}
