/**
 * BirdCloud AI 识鸟 · 服务端代理（阿里云函数计算 FC 版）
 * ============================================================
 * 用途：国内可直接访问的 AI 代理。
 *   Cloudflare workers.dev 子域在国内被 DNS 污染（解析到投毒 IP），无法直连；
 *   阿里云函数计算生成的 *.cn-hangzhou.fc.aliyuncs.com 公网 URL 国内可直连。
 *
 * 环境：阿里云函数计算 FC · Web 函数 · 运行时 Node.js 18/20
 * 环境变量：DASHSCOPE_KEY = 你的阿里云百炼 API-Key（sk-ws-...）
 *
 * 部署（约 5 分钟）：
 *   1) 用你的阿里云账号登录 https://fcnext.console.aliyun.com/
 *   2) 首次使用按提示开通函数计算（有免费额度）
 *   3) 创建函数 → 选「Web 函数」→ 运行时选 Node.js 20（或 18）
 *   4) 把下方 exports.handler 代码粘贴进 index.js（覆盖默认代码）→ 部署
 *   5) 函数详情 → 配置 → 环境变量：添加 DASHSCOPE_KEY = 你的百炼 Key
 *   6) 配置 → 触发器：创建 HTTP 触发器，认证方式必须选「匿名」（否则网页无法直接调用）
 *   7) 复制触发器公网 URL（形如 https://xxx.cn-hangzhou.fc.aliyuncs.com/...）
 *   8) 把该 URL 替换到 ai.html 顶部 PROXY_URL 常量并推送
 *
 * 请求 / 响应与 Cloudflare Worker 版一致：
 *   POST { "image": "data:image/jpeg;base64,..." } → { "ok": true, "content": "..." }
 */

const UPSTREAM = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

exports.handler = (req, resp) => {
  // CORS 预检：直接放行
  if (req.method === "OPTIONS") {
    return send(resp, 200, { ok: true });
  }
  let raw = "";
  req.on("data", (c) => {
    raw += c;
    if (raw.length > 13 * 1024 * 1024) req.destroy(); // 防止超大请求
  });
  req.on("error", () => send(resp, 400, { ok: false, error: "请求读取失败" }));
  req.on("end", () => { handle(raw, resp); });
};

async function handle(raw, resp) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return send(resp, 400, { ok: false, error: "请求体不是 JSON" });
  }
  const image = input.image;
  const model = input.model || "qwen3-vl-plus"; // 百炼新版视觉模型（qwen-vl-plus 旧名已下线）
  if (!image) {
    return send(resp, 400, { ok: false, error: "缺少 image 字段" });
  }
  if (image.length > 12 * 1024 * 1024) {
    return send(resp, 413, { ok: false, error: "图片过大（超过 12MB）" });
  }

  const key = process.env.DASHSCOPE_KEY;
  if (!key) {
    return send(resp, 500, { ok: false, error: "服务端未配置 DASHSCOPE_KEY 环境变量" });
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
      return send(resp, 502, { ok: false, error: "上游返回无法解析（HTTP " + r.status + "）" });
    }
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ("HTTP " + r.status);
      return send(resp, 502, { ok: false, error: String(msg).slice(0, 300) });
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : "";
    if (!content) {
      return send(resp, 502, { ok: false, error: "模型返回为空" });
    }
    return send(resp, 200, { ok: true, content: content });
  } catch (e) {
    return send(resp, 502, { ok: false, error: "上游调用失败：" + String(e.message || e).slice(0, 300) });
  }
}

function send(resp, status, obj) {
  resp.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  resp.end(JSON.stringify(obj));
}
