"""桌宠实时无损抓屏与状态查看辅助脚本。

通过请求桌宠主进程的调试回环端点（127.0.0.1:8525），
直接获取 Chromium GPU 合成层无损截屏并保存到本地。
"""

import sys
import urllib.request
import urllib.error
import time

TARGET_FILE = "D:/Frankenstein/deskpet_snapshot.png"
DEBUG_URL = f"http://127.0.0.1:8525/screenshot?save={TARGET_FILE}"

def main():
    print(f"[Snap] 正在请求桌宠实机截图: {DEBUG_URL} ...")
    try:
        req = urllib.request.Request(DEBUG_URL, headers={"User-Agent": "DeskpetDebugSnap/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read()
            status = resp.status
            print(f"[Snap] 截图成功！状态码: {status}, 大小: {len(data)} 字节, 已保存到: {TARGET_FILE}")
            return 0
    except urllib.error.URLError as e:
        print(f"[Snap] 请求失败，桌宠调试服务未就绪或未启动: {e}")
        return 1
    except Exception as e:
        print(f"[Snap] 抓屏发生未知异常: {e}")
        return 2

if __name__ == "__main__":
    sys.exit(main())
