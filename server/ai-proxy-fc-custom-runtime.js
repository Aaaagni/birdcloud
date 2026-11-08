/**
 * BirdCloud AI 识鸟 · 服务端代理（阿里云 FC 自定义运行时 · Node.js 22 版）
 * ============================================================
 * 环境：函数计算 FC · 自定义运行时（Debian 12）· Node.js 22
 * 部署：
 *   1) 创建函数：自定义运行时，运行时选 Node.js 22
 *   2) 代码页 index.js 粘贴本文件内容
 *   3) 函数配置：启动命令填  node index.js ；监听端口填 9000
 *   4) 环境变量：DASHSCOPE_KEY = 你的阿里云百炼 API-Key（sk-ws-...）
 *   5) 触发器：HTTP 触发器，认证方式选「匿名」，创建后复制公网 URL
 *   6) 把公网 URL 替换到 ai.html 顶部 PROXY_URL 常量并推送
 *
 * 请求 / 响应：
 *   POST { "image": "data:image/jpeg;base64,..." } → { "ok": true, "content": "..." }
 */
const http = require("http");
const https = require("https");

const UPSTREAM = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL = "qwen3-vl-plus";
const PORT = Number(process.env.FC_SERVER_PORT || 9000);

const SYSTEM_PROMPT =
  "你是一位专业的中国鸟类识别专家。仔细观察用户提供的照片，识别画面中的鸟类。\n" +
  "只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块。\n" +
  '{"is_bird": true或false, "species": "最可能的鸟种中文名，如不确定可写近似描述", ' +
  '"sci": "拉丁学名，不知道则填空字符串", "confidence": 0到100的整数，表示判断把握", ' +
  '"features": ["3到5个识别特征，按明显程度排序"], "habitat": "一句话描述其典型生境", ' +
  '"fun_fact": "一句趣味知识", "alternatives": ["其他可能候选鸟种名，最多2个，没有则空数组"]}\n' +
  "如果画面中没有鸟、主体不是鸟或根本无法判断，则 is_bird 为 false，species 填空字符串，其余字段可为空。";

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function callDashscope(key, image, model) {
  return new Promise((resolve, reject) => {
    const payload = {
      model: model,
      temperature: 0.2,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: image } },
            { type: "text", text: "请识别这张照片里的鸟，并严格按照要求输出 JSON。" }
          ]
        }
      ]
    };
    const body = JSON.stringify(payload);
    const u = new URL(UPSTREAM);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = {};
          try { json = JSON.parse(text); } catch (e) { /* ignore */ }
          if (resp.statusCode >= 400) {
            const msg = (json.error && json.error.message) || ("HTTP " + resp.statusCode);
            reject(new Error(String(msg).slice(0, 300)));
          } else {
            resolve(json);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(50000, () => req.destroy(new Error("上游超时")));
    req.end(body);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    });
    res.end();
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "仅支持 POST" });
    return;
  }

  const chunks = [];
  let size = 0;
  const MAX = 12 * 1024 * 1024;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX) {
      sendJson(res, 413, { ok: false, error: "请求体过大" });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let data;
    try {
      data = JSON.parse(raw || "{}");
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "请求体不是 JSON" });
    }
    const image = data.image;
    const model = data.model || MODEL;
    if (!image) return sendJson(res, 400, { ok: false, error: "缺少 image 字段" });
    if (image.length > 12 * 1024 * 1024) {
      return sendJson(res, 413, { ok: false, error: "图片过大（超过 12MB）" });
    }
    const key = process.env.DASHSCOPE_KEY || "";
    if (!key) return sendJson(res, 500, { ok: false, error: "服务端未配置 DASHSCOPE_KEY 环境变量" });
    try {
      const up = await callDashscope(key, image, model);
      let content = "";
      try { content = up.choices[0].message.content || ""; } catch (e) { /* ignore */ }
      if (!content) return sendJson(res, 502, { ok: false, error: "模型返回为空" });
      sendJson(res, 200, { ok: true, content: content });
    } catch (err) {
      sendJson(res, 502, { ok: false, error: "上游调用失败：" + String(err.message || err).slice(0, 300) });
    }
  });
  req.on("error", () => { /* ignore client aborts */ });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("BirdCloud proxy listening on " + PORT);
});
