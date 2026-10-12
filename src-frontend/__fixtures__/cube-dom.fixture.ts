/** 最小 DOM 替身只覆盖魔方渲染与视角事件；动画和绘制帧由用例主动推进。 */
export class TestCubeElement extends EventTarget {
  className = "";
  innerHTML = "";
  textContent = "";
  type = "";
  tabIndex = -1;
  isConnected = true;
  title = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: TestCubeElement[] = [];
  parentElement: TestCubeElement | null = null;
  style = { transform: "", transformOrigin: "", setProperty: () => undefined };
  classList = { add: () => undefined, remove: () => undefined, toggle: () => undefined };

  constructor(private readonly animations: EventTarget[]) { super(); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  appendChild(child: TestCubeElement): void {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
  }
  remove(): void {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  replaceChildren(): void { this.children = []; }
  getClientRects(): { length: number } { return { length: 1 }; }
  querySelectorAll(selector: string): TestCubeElement[] {
    return this.children.flatMap((child) => [
      ...(child.className.split(" ").includes(selector.slice(1)) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  animate(keyframes: Keyframe[]): EventTarget {
    const animation = Object.assign(new EventTarget(), { cancel: () => undefined, updatePlaybackRate: () => undefined });
    animation.addEventListener("finish", () => { this.style.transform = String(keyframes[keyframes.length - 1].transform); });
    this.animations.push(animation);
    return animation;
  }
}

export function withCubeDom(run: (root: TestCubeElement, animations: EventTarget[], frames: FrameRequestCallback[]) => void): void {
  const keys = ["document", "window", "HTMLElement"];
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const animations: EventTarget[] = [];
  const frames: FrameRequestCallback[] = [];
  const values = [
    { createElement: () => new TestCubeElement(animations), hidden: false },
    {
      requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
      matchMedia: () => ({ matches: false }),
      getComputedStyle: () => ({ visibility: "visible" }),
      setTimeout: () => 1, clearTimeout: () => undefined, queueMicrotask,
    },
    TestCubeElement,
  ];
  keys.forEach((key, index) => Object.defineProperty(globalThis, key, { configurable: true, value: values[index] }));
  try { run(new TestCubeElement(animations), animations, frames); }
  finally {
    keys.forEach((key, index) => {
      const original = originals[index];
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}
