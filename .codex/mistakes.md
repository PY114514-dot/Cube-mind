# 已知问题与处理准则

## Windows 启动后 3000 端口被占用

`npm run server` 会形成 npm → tsx → node 进程树。启动失败或中断时必须按进程树清理。

- 排查：`netstat -ano | findstr :3000`
- 启动器：`start.py` 使用 `taskkill /T /F` 清理其创建的进程树。
- 不要通过随意换端口掩盖残留进程。

## npm `.cmd` 包装器无法在受限环境启动

某些自动化环境无法执行 `npm.cmd`。可直接调用 Node 的入口脚本进行验证，例如：

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
node build.mjs
```

这只是一种验证环境兼容手段，用户本机仍应优先使用 npm scripts。

## 智能魔方时间戳异常

设备时间戳可能乱序或 16 位回绕。必须区分“时间质量异常”和“魔方未还原”；有效性不能只由单一时间戳倒退决定，也不能跳过最终状态回放。

## GAN V4 / 魔域陀螺仪

收到 gyro characteristic 或 `0xEC` 通知，只证明设备上报了姿态相关数据，不证明 payload 已可靠解析。没有真实包样本、字节布局和 fixture 前，不得将其接入 3D 姿态跟随。

