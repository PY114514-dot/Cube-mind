/**
 * 调试日志门控。
 *
 * 为什么存在：BLE 协议层诊断日志量大且含实时时序信息，普通用户不需要，
 * 而开发排查时必须随时可开。通过全局开关 `__CUBEMIND_DEBUG` 统一控制，
 * 避免提交前反复增删日志，也避免正常使用时控制台刷屏。
 *
 * 浏览器里 globalThis 即 window，因此在 DevTools 控制台执行
 * `window.__CUBEMIND_DEBUG = true` 即可开启诊断输出。
 * 开关要求严格为 boolean true（`1`、`"true"` 等真值不生效），
 * 防止第三方脚本误注入字符串开关造成日志泄漏。
 */

interface CubeMindDebugGlobal {
  __CUBEMIND_DEBUG?: boolean;
}

/**
 * 读取当前调试开关状态。每次调用时读取（不缓存），
 * 为什么：开发者在控制台开关后无需刷新页面即可生效。
 */
export function isCubeMindDebugEnabled(): boolean {
  const g = globalThis as unknown as CubeMindDebugGlobal;
  return g.__CUBEMIND_DEBUG === true;
}

/**
 * 门控版 console.log：开关关闭时静默，开启时原样转发全部参数。
 */
export function debugLog(...args: unknown[]): void {
  if (isCubeMindDebugEnabled()) {
    console.log(...args);
  }
}
