"""CubeMind 一键启动脚本（Windows 优先）。"""

from __future__ import annotations

import json
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from types import FrameType


ROOT = Path(__file__).resolve().parent
URL = "http://localhost:3000"
HEALTH_URL = f"{URL}/api/health"
READY_TIMEOUT_S = 12.0
POLL_INTERVAL_S = 0.25
REQUEST_TIMEOUT_S = 0.8
REQUIRED_NPM_SCRIPTS = ("build", "server")

_server: subprocess.Popen | None = None


def find_command(name: str) -> str | None:
    """定位可执行文件；PATHEXT 失效时才显式尝试 Windows 扩展名。"""
    command = shutil.which(name)
    if command or sys.platform != "win32":
        return command
    for suffix in (".cmd", ".bat", ".exe"):
        command = shutil.which(f"{name}{suffix}")
        if command:
            return command
    return None


def run_step(command: list[str], title: str) -> None:
    print(f"\n==> {title}")
    # 不捕获输出，npm 的 registry、node-gyp 等原始报错会实时显示给用户。
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode != 0:
        raise RuntimeError(f"{title}失败，退出码: {result.returncode}。请查看上方 npm 输出。")


def validate_package_scripts() -> None:
    package_path = ROOT / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"无法读取 package.json：{error}") from error

    scripts = package.get("scripts")
    if not isinstance(scripts, dict):
        raise RuntimeError("package.json 缺少 scripts 配置。")
    missing = [name for name in REQUIRED_NPM_SCRIPTS if not isinstance(scripts.get(name), str)]
    if missing:
        raise RuntimeError(f"package.json 缺少启动脚本：{', '.join(missing)}。")


def needs_npm_install() -> bool:
    """锁文件更新或 npm 的安装元数据缺失时，重新让 npm 校准依赖。"""
    node_modules = ROOT / "node_modules"
    if not node_modules.is_dir():
        return True
    package_lock = ROOT / "package-lock.json"
    installed_lock = node_modules / ".package-lock.json"
    if not package_lock.is_file() or not installed_lock.is_file():
        return True
    return package_lock.stat().st_mtime > installed_lock.stat().st_mtime


def wait_for_server(server: subprocess.Popen, timeout_seconds: float = READY_TIMEOUT_S) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        return_code = server.poll()
        if return_code is not None:
            raise RuntimeError(
                f"后端 npm 进程已退出（退出码: {return_code}）。"
                "请在项目目录执行 `npm run server` 查看具体错误。"
            )
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=REQUEST_TIMEOUT_S) as response:
                if response.status == 200:
                    return
        except urllib.error.URLError:
            time.sleep(POLL_INTERVAL_S)
    raise RuntimeError(
        f"后端在 {timeout_seconds:g} 秒内仍未健康就绪。"
        "它可能仍在运行但端口被占用或路由未启动。\n"
        "排查：Windows 请执行 `netstat -ano | findstr :3000`；"
        "随后在项目目录执行 `npm run server` 查看启动日志。"
    )


def stop_server(server: subprocess.Popen | None) -> None:
    """停止 npm 及其 tsx/node 子进程，避免下次启动撞 3000 端口。"""
    if server is None or server.poll() is not None:
        return
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(server.pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as error:
            print(f"无法停止后端进程树：{error}")
        return
    server.terminate()
    try:
        server.wait(timeout=3)
    except subprocess.TimeoutExpired:
        server.kill()


def open_browser() -> None:
    try:
        if not webbrowser.open(URL):
            print(f"浏览器未能自动打开，请手动访问：{URL}")
    except Exception as error:  # webbrowser 依赖系统注册表，失败不能影响服务本身。
        print(f"浏览器未能自动打开，请手动访问：{URL}（{error}）")


def pause_before_exit() -> None:
    if not sys.stdin or not sys.stdin.isatty():
        return
    try:
        input("按回车键退出...")
    except EOFError:
        pass


def handle_stop_signal(_signum: int, _frame: FrameType | None) -> None:
    global _server
    print("\n正在停止 CubeMind...")
    stop_server(_server)
    raise KeyboardInterrupt


def install_signal_handlers() -> None:
    signal.signal(signal.SIGINT, handle_stop_signal)
    signal.signal(signal.SIGTERM, handle_stop_signal)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, handle_stop_signal)


def start_server(npm: str) -> subprocess.Popen:
    options: dict[str, int] = {}
    if sys.platform == "win32":
        options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    return subprocess.Popen([npm, "run", "server"], cwd=ROOT, **options)


def main() -> int:
    global _server
    install_signal_handlers()
    npm = find_command("npm")
    if not npm:
        print("未找到 Node.js/npm，请先安装 Node.js LTS： https://nodejs.org/")
        return 1

    try:
        validate_package_scripts()
        if needs_npm_install():
            run_step([npm, "install"], "安装或同步依赖")

        run_step([npm, "run", "build"], "构建前端")
        _server = start_server(npm)
        wait_for_server(_server)
        print(f"\nCubeMind 前后端均已就绪：{URL}")
        print("浏览器将自动打开；按 Ctrl+C 停止服务。")
        threading.Thread(target=open_browser, daemon=True).start()
        return _server.wait()
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError) as error:
        print(f"\n启动失败：{error}")
        pause_before_exit()
        return 1
    finally:
        stop_server(_server)
        _server = None


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"\n发生未处理错误：{error}")
        pause_before_exit()
        raise SystemExit(1)
