/**
 * BirdCloud AI 识鸟 · 服务端代理
 * ============================================================
 * 作用：隐藏视觉识别 API 的 API-Key。
 *   - 页面只把图片发给本代理（请求体仅 { image: "data:..." }）；
 *   - API-Key 只存在于本代理的环境变量中，不出现于页面源码/网络请求；
 *   - 代理把图片转发给上游视觉模型，返回识别结果。
 *
 * 部署（Cloudflare Workers，免费）：
 *   1) 注册/登录 https://dash.cloudflare.com → Workers & Pages → 创建 Worker；
 *   2) 把本文件全部代码粘贴进 Worker 编辑器；
 *   3) 在 Worker「设置 → 变量与机密」添加环境变量：
 *        DASHSCOPE_KEY = 你的 Key（sk-...）
 *      说明：兼容 DashScope 兼容端点（/compatible-mode/v1/chat/completions）的
 *      聚合网关 Key 可直接使用（如 sk-ws- 开头的聚合 Key，模型名 qwen3-vl-plus 等）。
 *   4) 部署后得到 https://birdid.你的子域.workers.dev 地址；
 *   5) 把该地址替换到 ai.html 顶部 PROXY_URL 常量中并推送。
 *
 * 请求（POST 代理地址）：
 *   { "image": "data:image/jpeg;base64,..." }            ← 页面实际发送
 *   可选：{ "provider": "dashscope"|"siliconflow", "model": "模型名", "image": ... }
 *   未提供 provider/model 时默认：dashscope + qwen3-vl-plus
 *
 * 响应：
 *   成功 { "ok": true,  "content": "模型返回的文本" }
 *   失败 { "ok": false, "error": "原因" }
 */
export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json({ ok: false, error: "仅支持 POST" }, 405);
    }
    let input;
    try {
      input = await request.json();
    } catch (e) {
      return json({ ok: false, error: "请求体不是 JSON" }, 400);
    }
    const provider = input.provider || "dashscope";
    const model = input.model || "qwen3-vl-plus";
    const image = input.image;
    if (!image) {
      return json({ ok: false, error: "缺少 image 字段" }, 400);
    }
    if (image.length > 12 * 1024 * 1024) {
      return json({ ok: false, error: "图片过大（超过 12MB）" }, 413);
    }

    const PROVIDERS = {
      dashscope: {
        url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        key: env.DASHSCOPE_KEY
      },
      siliconflow: {
        url: "https://api.siliconflow.cn/v1/chat/completions",
        key: env.SILICONFLOW_KEY
      }
    };
    const p = PROVIDERS[provider];
    if (!p) {
      return json({ ok: false, error: "未知服务商：" + provider }, 400);
    }
    if (!p.key) {
      return json({ ok: false, error: "服务端未配置该服务商的 API-Key（环境变量）" }, 500);
    }

    const sysPrompt = [
      "你是一位专业的中国鸟类识别专家。仔细观察用户提供的照片，识别画面中的鸟类。",
      "只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块。",
      '{"is_bird": true或false, "species": "最可能的鸟种中文名，如不确定可写近似描述", "sci": "拉丁学名，不知道则填空字符串", "confidence": 0到100的整数，表示判断把握", "features": ["3到5个识别特征，按明显程度排序"], "habitat": "一句话描述其典型生境", "fun_fact": "一句趣味知识", "alternatives": ["其他可能候选鸟种名，最多2个，没有则空数组"]}',
      "如果画面中没有鸟、主体不是鸟或根本无法判断，则 is_bird 为 false，species 填空字符串，其余字段可为空。"
    ].join("\n");

    const upstream = await fetch(p.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + p.key
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
      data = await upstream.json();
    } catch (e) {
      return json({ ok: false, error: "上游返回无法解析（HTTP " + upstream.status + "）" }, 502);
    }
    if (!upstream.ok) {
      const msg = (data && data.error && data.error.message) || ("HTTP " + upstream.status);
      return json({ ok: false, error: String(msg).slice(0, 300) }, upstream.status);
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : "";
    if (!content) {
      return json({ ok: false, error: "模型返回为空" }, 502);
    }
    return json({ ok: true, content: content });
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/* Supabase Edge Functions 移植方法：
 * 把上面的逻辑提取为一个 async function handle(req) { ... env 换成 Deno.env.get("DASHSCOPE_KEY") }
 * 然后导出：Deno.serve(async (req) => await handle(req));
 * 并在 Supabase 面板设置 Secrets：DASHSCOPE_KEY / SILICONFLOW_KEY。 */
