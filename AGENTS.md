# AGENTS.md

## 1. 项目定义

**CubeMind** —— 面向 CFOP 竞速玩家的本地化 AI 解法分析助手。

连接 GAN / 魔域智能魔方，自动拆分 CFOP 四阶段用时，通过 DeepSeek AGENT 识别瓶颈并生成训练计划。

**MVP 范围**：Web Demo（Chrome Web Bluetooth），仅支持 3x3 + GAN v2 协议 + 魔域协议。

---

## 2. 架构与构建

### 2.1 技术栈
- **语言**：TypeScript（strict 模式）
- **模块系统**：ES Modules（浏览器原生，无打包器）
- **BLE**：Chrome Web Bluetooth API
- **AGENT**：DeepSeek API（API_KEY 硬编码，仅 Demo）
- **存储**：localStorage
- **3D 渲染**：Three.js（预留，P2）
- **运行**：Deno（原生支持 .ts） 或 编译为 .js 用浏览器跑

### 2.2 目录结构
```
d:\计时器\
├── index.html              ← Demo 入口（由 dist/ 托管）
├── AGENTS.md               ← 本文件
├── README.md               ← 使用说明
├── package.json            ← npm scripts + deps
├── tsconfig.json           ← strict, ES2020, Bundler resolution
├── build.mjs              ← esbuild: bootstrap.ts → dist/bundle.js (IIFE)
├── start.bat / start.py   ← 一键启动
├── doc\                    ← 文档（产品/技术/日志/反馈）
│   ├── 01-product\
│   ├── 02-tech\
│   ├── 03-dev-log\daily-log\
│   └── 04-user-feedback\
├── cstimer\                ← 参考源（不复刻，仅查阅，tsconfig 排除）
├── dist\                   ← 构建产物（bundle.js + index.html）
├── src-frontend\           ← 浏览器端 TypeScript（esbuild 打包）
│   ├── bootstrap.ts        ← 入口（错误边界 + 动态 import main.ts）
│   ├── main.ts             ← 应用编排层（计时/解法生命周期/练习模式）
│   ├── ble\                ← BLE 协议层
│   │   ├── cube-driver.ts  ← 统一 CubeDriver 接口
│   │   ├── gan-cube-protocol.ts  ← GAN v1-v4（implements CubeDriver）
│   │   ├── moyu-cube-protocol.ts ← 魔域 MHC + MoYu32（implements CubeDriver）
│   │   ├── gan-crypto.ts / aes128.ts ← AES-128 加解密
│   │   └── ble-packet-harness.ts ← 录制/回放测试工具
│   ├── controllers\        ← UI 控制器（DOM 绑定 + 状态管理）
│   │   ├── ble-connection-controller.ts ← BLE 连接生命周期（CubeDriver[] 驱动）
│   │   ├── settings-controller.ts
│   │   ├── formula-library-controller.ts
│   │   ├── history-controller.ts
│   │   └── timer-display-controller.ts
│   ├── core\               ← 业务核心（纯函数，可单测）
│   ├── agent\              ← DeepSeek 接入 + 分析控制器
│   ├── formula\            ← CFOP 公式库（F2L/OLL/PLL）
│   ├── scramble\           ← WCA 打乱生成
│   ├── ui\                 ← 3D 渲染、回放播放器
│   ├── utils\              ← 通用工具（mathlib、quaternion）
│   ├── types\              ← 环境声明（web-bluetooth.d.ts）
│   ├── __tests__\          ← 单元测试（node:test + tsx）
│   └── __fixtures__\       ← 测试数据
├── src-backend\            ← Node.js Express 服务端（tsx watch 运行）
│   ├── server.ts / app.ts
│   ├── routes\             ← /api/analyze, /api/solves, /api/diagnostics
│   └── services\           ← DeepSeek 客户端 + fallback
└── src-shared\             ← 前后端共享类型 + 本地分析 fallback
    ├── analysis-types.ts
    ├── local-analysis-fallback.ts
    └── training-plan-types.ts
```

### 2.3 模块依赖规则
- `ble/` 只依赖 `utils/`；`ble/cube-driver.ts` 是接口层，不依赖具体实现
- `core/` 可依赖 `ble/`（仅类型）、`scramble/`、`agent/`（仅类型）、`utils/`
- `controllers/` 可依赖 `core/`、`ble/`（仅类型 + CubeDriver 接口）、`formula/`、`ui/`、`utils/`
- `ui/` 可依赖 `core/`、`utils/`
- `main.ts` 是 composition root，可 import 一切
- **禁止反向依赖**（如 `ble/` 不能 import `controllers/` 或 `core/` 的实现）

### 2.4 构建命令

**方案 A：Deno（推荐，无需编译）**
```bash
deno run --allow-net --allow-read --allow-write --reload http://localhost:8080
```

**方案 B：esbuild（产出 .js 部署）**
```bash
npx esbuild src/main.ts --bundle --format=esm --outfile=dist/bundle.js
```

**方案 C：原生 .ts 调试**
```bash
# Chrome 需加启动参数 --allow-file-access-from-files
python -m http.server 8080
```

### 2.5 运行入口
- 开发服务器：`npm run serve` → http://localhost:3000（构建后由后端统一托管前端与 API）
- Demo 页面：`index.html`
- 每次新增模块必须在 `index.html` 末尾 `<script type="module">` 中验证

### 2.6 BLE 驱动扩展
新增品牌魔方只需三步：
1. 在 `ble/` 下新建 `xxx-cube-protocol.ts`，实现 `CubeDriver` 接口
2. 在 `index.html` 连接面板加对应按钮和 MAC 输入框
3. 在 `main.ts` 的 `driverSlots` Map 和 drivers 数组中注册

controller 主逻辑无需修改。

---

## 3. 版本节奏

每完成一个**里程碑**必须做三件事：**测试 → 代码审查 → 更新日志**。

### 3.1 里程碑定义

| 里程碑 | 内容 | 必须通过的测试 |
|--------|------|---------------|
| M1 | BLE 连接 + 打乱生成 | 浏览器能连上 GAN/魔域，打乱无连续同轴 |
| M2 | 计时器 + Move 流 | 转动魔方，UI 实时显示 move + 时间间隔 |
| M3 | CFOP 阶段识别 | 30 个标准解法，识别准确率 ≥85% |
| M4 | DeepSeek AGENT | 阶段用时 → 中文分析，输出含瓶颈+训练建议 |
| M5 | UI 完善 + 用户验证 | 3 个目标用户完成访谈，反馈记录到 doc/04 |

### 3.2 测试要求

- **每个新模块必须配单元测试**：放在 `src/__tests__/` 下，文件名 `<模块名>.test.ts`
- **测试运行**：`deno test src/__tests__/`
- **覆盖标准**：核心算法（打乱、CFOP 解析、move 解析）覆盖率 ≥80%
- **手动测试**：每次里程碑在 Chrome 真实跑一遍，记录到 `doc/03-dev-log/daily-log/day-XX.md`

### 3.3 代码审查要点

每完成一个里程碑自查：
1. **死代码**：未使用的 import、函数、变量必须删除
2. **重复代码**：相同逻辑出现 2 次以上 → 抽函数
3. **类型安全**：禁用 `any`、禁用 `@ts-ignore`（必要时用 `unknown` + 收窄）
4. **依赖方向**：检查 import 是否违反 2.3 的依赖规则
5. **错误处理**：所有 BLE / API 调用必须有 catch + 用户可见的提示

审查结果记录到当日日志的 `## 自查` 小节。

### 3.4 日志规范

每次开发结束必须更新 `doc/03-dev-log/daily-log/day-XX.md`：
- ✅ 今天完成（具体到文件名 + 行数）
- 🤔 待解决（明确阻塞点）
- 📅 明天计划（对应 7day-plan.md 哪一步）

---

## 4. 代码风格

### 4.1 命名
- **文件名**：kebab-case + 后缀（`gan-cube-protocol.ts`）
- **类名**：PascalCase（`GanCube`）
- **函数/变量**：camelCase（`scramble333`）
- **常量**：UPPER_SNAKE（`SOLVED_FACELET`）
- **接口**：PascalCase，I 前缀可选（`CubeMove` 比 `ICubeMove` 优先）
- **私有成员**：下划线前缀（`_device`）或 TypeScript `private`

### 4.2 注释
- **中文注释**，仅解释 *为什么*，不解释 *做了什么*
- JSDoc 仅用于导出的公共 API
- 行内注释用 `//` 不用 `/* */`
- TODO 必须带作者和日期：`// TODO(2026-07-03): 实现 GAN v2 加密`

### 4.3 函数
- 单函数不超过 **80 行**（超出必须拆分）
- 单文件不超过 **400 行**（超出必须拆模块）
- 优先纯函数，避免副作用
- 异步函数必须返回 `Promise<T>`，明确类型

### 4.4 错误处理
- **绝不静默吞错**：`catch (e) {}` 禁止，至少 `console.error(e)`
- 用户可见错误：`throw new Error(\`[模块名] 具体描述: ${detail}\`)`
- BLE 错误：在 catch 中调用 `disconnect()` 清理资源

### 4.5 Import / Export
- 使用 ES Modules：`import { foo } from "./bar.ts"`
- **导入路径必须包含 `.ts` 后缀**（Deno 必需）
- 每个模块显式声明 `export`，不导出内部实现
- 类型导入用 `import type { Foo } from "./bar.ts"`

### 4.6 TypeScript
- `strict: true`、`noImplicitAny: true`、`strictNullChecks: true`
- 数组用 `T[]` 不用 `Array<T>`
- 对象用 `interface` 不用 `type`（除非需要联合类型）
- 枚举用 `as const` 对象替代（`const Axis = { U: 0, R: 1 } as const`）

### 4.7 禁止项
- ❌ `any` 类型
- ❌ `@ts-ignore`
- ❌ `console.log` 调试残留（提交前删除）
- ❌ 硬编码密钥/URL（除 Demo 阶段的 DeepSeek API_KEY）
- ❌ jQuery、Lodash 等运行时依赖
- ❌ 中文变量名 / 中文文件名

---

## 5. 关键决策记录

| 决策点 | 选择 | 锁定日期 |
|--------|------|----------|
| 目标用户 | CFOP 竞速玩家 sub-30 | 2026-07-03 |
| 平台 | Web（Chrome Web Bluetooth） | 2026-07-03 |
| BLE 库 | Chrome Web Bluetooth API | 2026-07-03 |
| 智能魔方品牌 | GAN 优先（v2 协议），后续加魔域 | 2026-07-03 |
| AGENT | DeepSeek | 2026-07-03 |
| 鉴权 | 无（Demo 级） | 2026-07-03 |
| 存储 | localStorage | 2026-07-03 |
| 与 cstimer 关系 | 独立产品，仅学习打乱格式和 UI | 2026-07-03 |
| 代码风格 | TypeScript strict + ES Modules + 中文注释 | 2026-07-03 |

变更决策时更新此表，并在当日日志说明原因。
