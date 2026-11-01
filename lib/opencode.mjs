const DEFAULT_API_BASE = "https://opencode.ai/inference/go/openai/v1";
const DEFAULT_MODEL = "deepseek-v4.1-flash";
const DEFAULT_MAX_TOKENS = 1500;
const MAX_INPUT_CHARS = 12000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function getApiBase() {
  return (process.env.OPENCODE_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
}

export function getModel() {
  return (process.env.OPENCODE_MODEL || DEFAULT_MODEL).trim();
}

export function keyConfigured() {
  return Boolean((process.env.OPENCODE_API_KEY || "").trim());
}

function getApiKey() {
  const key = (process.env.OPENCODE_API_KEY || "").trim();
  if (!key) {
    throw new HttpError(500, "服务端还没有配置 OPENCODE_API_KEY");
  }
  return key;
}

function getMaxTokens() {
  const value = Number(process.env.OPENCODE_MAX_TOKENS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_TOKENS;
}

function normalizeMessages(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new HttpError(400, "messages 不能为空");
  }

  let totalChars = 0;
  const messages = body.messages.map((message) => {
    if (
      !message ||
      typeof message.role !== "string" ||
      typeof message.content !== "string"
    ) {
      throw new HttpError(400, "messages 格式不正确");
    }

    const role = message.role.trim();
    if (!["system", "user", "assistant"].includes(role)) {
      throw new HttpError(400, "不支持的 message role");
    }

    totalChars += message.content.length;
    return { role, content: message.content };
  });

  if (totalChars > MAX_INPUT_CHARS) {
    throw new HttpError(400, "输入内容太长");
  }

  return messages;
}

export async function chatCompletion(body) {
  const messages = normalizeMessages(body);
  const key = getApiKey();
  const model = getModel();
  const requestedModel = typeof body.model === "string" ? body.model.trim() : "";

  if (requestedModel && requestedModel !== model) {
    throw new HttpError(400, `当前只支持模型 ${model}`);
  }

  const requestedTemperature = Number(body.temperature);
  const temperature = Number.isFinite(requestedTemperature)
    ? Math.min(2, Math.max(0, requestedTemperature))
    : 1.1;

  const upstream = await fetch(`${getApiBase()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${key}`,
      "User-Agent": "combo-lab/1.0",
      "x-opencode-session": process.env.OPENCODE_SESSION_ID || "combo-lab",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: getMaxTokens(),
      stream: false,
      // 关闭思考链：合成玩法只要脑洞不要推理，显著降低响应延迟
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(60000),
  });

  const text = await upstream.text();
  return {
    status: upstream.status,
    contentType:
      upstream.headers.get("content-type") || "application/json; charset=utf-8",
    text,
  };
}
