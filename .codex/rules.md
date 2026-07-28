# CubeMind 开发规则

本文件是 AI Agent 和人工协作的项目护栏。`AGENTS.md` 是更高优先级的工程约束；发生冲突时以 `AGENTS.md` 为准。

## 不可降低的正确性标准

- 不能为了让一条成绩计入统计而跳过“魔方最终已还原”校验。
- 不能为了掩盖 BLE 丢包、乱序或协议未知字段而伪造动作、时间戳或姿态。
- GAN / 魔域新协议字段必须先有真实通知包样本和纯函数测试，再接入 UI 或成绩逻辑。
- 不删除、跳过或弱化既有测试来使验证通过。

## 修改边界

- `src-frontend/ble/` 只依赖 `utils/`；不得反向依赖 `core/` 或 `ui/`。
- `src-frontend/core/` 负责状态、计时、校验和分析；`ui/` 只渲染与绑定事件。
- 公式库视觉可以修改 `formula/`、`ui/`、`index.html`，但公式 setup 必须仍可通过 `formula-setup-validation`。
- 构建产物 `dist/` 不手工编辑。
- `cstimer/` 仅作参考，不直接复制代码或资源。

## 质量要求

- 新增或修正纯逻辑时，在 `src-frontend/__tests__/` 或 `src-backend/__tests__/` 增加回归用例。
- TypeScript 保持 strict；不使用 `any`、`@ts-ignore` 或静默吞错。
- 每次实现完成必须运行与风险相称的测试；跨模块、BLE、计时或构建改动必须运行 `npm run harness:verify`。
- 完成报告必须写清：修改文件、行为变化、验证结果、仍需真机确认的风险。

