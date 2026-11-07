/**
 * BirdCloud AI 识鸟 · 服务端代理（阿里云函数计算 FC 版 · 双格式兼容）
 * ============================================================
 * 用途：国内可直接访问的 AI 代理（workers.dev 子域在国内被 DNS 污染，无法直连）。
 * 环境：阿里云函数计算 FC · Node.js 18/20
 *   - 兼容「Web 函数」入口：exports.handler = function(req, resp)（Node http 风格）
 *   - 兼容「事件函数 + HTTP 触发器」入口：exports.handler = function(event, context)
 *     自动按第一个参数形态识别，两种部署方式都能跑。
 * 环境变量：DASHSCOPE_KEY = 你的阿里云百炼 API-Key（sk-ws-...）
 *
 * 部署：
 *   1) 登录 https://fcnext.console.aliyun.com/ → 函数计算
 *   2) 创建函数（Web 函数或事件函数均可，运行时选 Node.js 18/20）
 *   3) 把本文件代码粘贴进 index.js（覆盖默认代码）→ 部署
 *   4) 配置 → 环境变量：DASHSCOPE_KEY = 你的百炼 Key
 *   5) 触发器：创建 HTTP 触发器，认证方式必须选「匿名」
 *   6) 复制公网 URL，替换到 ai.html 顶部 PROXY_URL 常量并推送
 *
 * 请求 / 响应：
 *   POST { "image": "data:image/jpeg;base64,..." } → { "ok": true, "content": "..." }
 */

const UPSTREAM = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

// ---- 统一入口：自动识别 Web 函数 / 事件函数 ----
exports.handler = function () {
  const a0 = arguments[0];
  // Web 函数：第一个参数是 http.IncomingMessage（有 .on 方法）
  if (a0 && typeof a0 === "object" && typeof a0.on === "function") {
    return webHandle(a0, arguments[1]);
  }
  // 事件函数：第一个参数是 event（字符串或对象）
  return eventHandle(a0);
};

// ---- Web 函数入口（Node http 风格）----
function webHandle(req, resp) {
  if (req.method === "OPTIONS") return send(resp, 200, { ok: true }); // CORS 预检
  let raw = "";
  req.on("data", (c) => {
    raw += c;
    if (raw.length > 13 * 1024 * 1024) req.destroy();
  });
  req.on("error", () => send(resp, 400, { ok: false, error: "请求读取失败" }));
  req.on("end", async () => {
    const r = await process(raw);
    send(resp, r.status, r.obj);
  });
}

// ---- 事件函数入口（HTTP 触发器封装的事件）----
async function eventHandle(event) {
  let e = {};
  if (typeof event === "string") {
    try { e = JSON.parse(event); } catch (_) { e = { body: event }; }
  } else if (event && typeof event === "object") {
    e = event;
  }
  const method = String(e.method || "GET").toUpperCase();
  if (method === "OPTIONS") return evResp(200, { ok: true }); // CORS 预检
  let raw = e.body || "";
  if (e.isBase64Encoded) {
    try { raw = Buffer.from(raw, "base64").toString("utf8"); } catch (_) {}
  }
  if (!raw) raw = "{}"; // GET 等无 body 请求
  const r = await process(raw);
  return evResp(r.status, r.obj);
}

// ---- 核心业务：图片 → 百炼视觉模型 → 识别结果 ----
async function process(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return { status: 400, obj: { ok: false, error: "请求体不是 JSON" } };
  }
  const image = input.image;
  const model = input.model || "qwen3-vl-plus"; // 百炼新版视觉模型（旧名 qwen-vl-plus 已下线）
  if (!image) {
    return { status: 400, obj: { ok: false, error: "缺少 image 字段" } };
  }
  if (image.length > 12 * 1024 * 1024) {
    return { status: 413, obj: { ok: false, error: "图片过大（超过 12MB）" } };
  }

  const key = process.env.DASHSCOPE_KEY;
  if (!key) {
    return { status: 500, obj: { ok: false, error: "服务端未配置 DASHSCOPE_KEY 环境变量" } };
  }

  const sysPrompt = [
    "你是一位专业的中国鸟类识别专家。仔细观察用户提供的照片，识别画面中的鸟类。",
    "只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块。",
    '{"is_bird": true或false, "species": "最可能的鸟种中文名，如不确定可写近似描述", "sci": "拉丁学名，不知道则填空字符串", "confidence": 0到100的整数，表示判断把握", "features": ["3到5个识别特征，按明显程度排序"], "habitat": "一句话描述其典型生境", "fun_fact": "一句趣味知识", "alternatives": ["其他可能候选鸟种名，最多2个，没有则空数组"]}',
    "如果画面中没有鸟、主体不是鸟或根本无法判断，则 is_bird 为 false，species 填空字符串，其余字段可为空。"
  ].join("\n");

  try {
    const r = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key
      },
      body: JSON.stringify({
        model: model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: "system", content: sysPrompt },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: image } },
              { type: "text", text: "请识别这张照片里的鸟，并严格按照要求输出 JSON。" }
            ]
          }
        ]
      })
    });

    let data;
    try {
      data = await r.json();
    } catch (e) {
      return { status: 502, obj: { ok: false, error: "上游返回无法解析（HTTP " + r.status + "）" } };
    }
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ("HTTP " + r.status);
      return { status: 502, obj: { ok: false, error: String(msg).slice(0, 300) } };
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : "";
    if (!content) {
      return { status: 502, obj: { ok: false, error: "模型返回为空" } };
    }
    return { status: 200, obj: { ok: true, content: content } };
  } catch (e) {
    return { status: 502, obj: { ok: false, error: "上游调用失败：" + String(e.message || e).slice(0, 300) } };
  }
}

// ---- Web 函数响应 ----
function send(resp, status, obj) {
  resp.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  resp.end(JSON.stringify(obj));
}

// ---- 事件函数响应 ----
function evResp(status, obj) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(obj),
    isBase64Encoded: false
  };
}

// ---- 兼容 fcnext v3 事件函数默认入口名 index.main ----
exports.main = exports.handler;
