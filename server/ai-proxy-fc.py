#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BirdCloud AI 识鸟 · 服务端代理（阿里云 FC 自定义运行时 · Python 3.10 版）
============================================================
部署要点（你的函数已匹配以下配置）：
  - 运行环境：自定义运行时（Debian10）Python 3.10
  - 启动命令：python3 app.py
  - 监听端口：9000
  - 环境变量：DASHSCOPE_KEY = 你的阿里云百炼 API-Key（sk-ws-...）
  - 代码位置：把本文件全部内容粘贴到函数代码页的 app.py（覆盖默认内容），部署即可
  - HTTP 触发器：认证方式「匿名」

请求 / 响应：
  POST { "image": "data:image/jpeg;base64,..." } → { "ok": true, "content": "..." }
"""

import json
import os
import urllib.request
import urllib.error

from http.server import BaseHTTPRequestHandler, HTTPServer

UPSTREAM = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
MODEL = "qwen3-vl-plus"  # 百炼新版视觉模型（旧名 qwen-vl-plus 已下线）

SYSTEM_PROMPT = (
    "你是一位专业的中国鸟类识别专家。仔细观察用户提供的照片，识别画面中的鸟类。\n"
    "只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块。\n"
    '{"is_bird": true或false, "species": "最可能的鸟种中文名，如不确定可写近似描述", '
    '"sci": "拉丁学名，不知道则填空字符串", "confidence": 0到100的整数，表示判断把握", '
    '"features": ["3到5个识别特征，按明显程度排序"], "habitat": "一句话描述其典型生境", '
    '"fun_fact": "一句趣味知识", "alternatives": ["其他可能候选鸟种名，最多2个，没有则空数组"]}\n'
    "如果画面中没有鸟、主体不是鸟或根本无法判断，则 is_bird 为 false，species 填空字符串，其余字段可为空。"
)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        # CORS 预检：直接放行
        self._send(200, {"ok": True})

    def do_GET(self):
        self._send(405, {"ok": False, "error": "仅支持 POST"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8", "replace")
            try:
                data = json.loads(raw)
            except Exception:
                return self._send(400, {"ok": False, "error": "请求体不是 JSON"})

            image = data.get("image")
            model = data.get("model") or MODEL
            if not image:
                return self._send(400, {"ok": False, "error": "缺少 image 字段"})
            if len(image) > 12 * 1024 * 1024:
                return self._send(413, {"ok": False, "error": "图片过大（超过 12MB）"})

            key = os.environ.get("DASHSCOPE_KEY", "")
            if not key:
                return self._send(500, {"ok": False, "error": "服务端未配置 DASHSCOPE_KEY 环境变量"})

            payload = {
                "model": model,
                "temperature": 0.2,
                "max_tokens": 600,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": image}},
                            {"type": "text", "text": "请识别这张照片里的鸟，并严格按照要求输出 JSON。"},
                        ],
                    },
                ],
            }
            req = urllib.request.Request(
                UPSTREAM,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + key,
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=55) as resp:
                    up = json.loads(resp.read().decode("utf-8", "replace"))
            except urllib.error.HTTPError as e:
                try:
                    up = json.loads(e.read().decode("utf-8", "replace"))
                except Exception:
                    up = {}
                if not isinstance(up, dict):
                    up = {}
                msg = (up.get("error") or {}).get("message") or ("HTTP " + str(e.code))
                return self._send(502, {"ok": False, "error": str(msg)[:300]})

            content = ""
            try:
                content = up["choices"][0]["message"]["content"] or ""
            except Exception:
                pass
            if not content:
                return self._send(502, {"ok": False, "error": "模型返回为空"})
            return self._send(200, {"ok": True, "content": content})
        except Exception as ex:
            return self._send(502, {"ok": False, "error": "上游调用失败：" + str(ex)[:300]})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 9000), Handler).serve_forever()
