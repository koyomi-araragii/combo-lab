import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PROVIDERS = ["auto", "pollinations", "openai"];
const DEFAULT_PROVIDER = "auto";
const DEFAULT_POLLINATIONS_MODEL = "flux";
const DEFAULT_OPENAI_MODEL = "gpt-image-1";
const DEFAULT_IMAGE_SIZE = "1024x1024";
const DEFAULT_DIMENSION = 768;
const MIN_DIMENSION = 256;
const MAX_DIMENSION = 1024;
const MIN_PROMPT_CHARS = 3;
const MAX_PROMPT_CHARS = 1200;
const MAX_SEED = 2147483647;
const POLLINATIONS_COOLDOWN_MS = 45000;
const POLLINATIONS_TIMEOUT_MS = 45000;
const POLLINATIONS_RETRY_DELAY_MS = 1800;
const OPENAI_TIMEOUT_MS = 60000;
const OPENAI_DOWNLOAD_TIMEOUT_MS = 20000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MEMORY_CACHE_LIMIT = 80;
const MEMORY_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CACHE_DIR = ".cache/images";
const FALLBACK_ERROR_CODES = ["TIMEOUT", "UPSTREAM_FAILED", "RATE_LIMITED"];
const USER_AGENT = "combo-lab/1.0";

export class ImageError extends Error {
  constructor(status, message, code, retryAfter) {
    super(message);
    this.name = "ImageError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function getProviderSetting() {
  const value = (process.env.IMAGE_PROVIDER || "").trim().toLowerCase();
  return PROVIDERS.includes(value) ? value : DEFAULT_PROVIDER;
}

function getOpenaiConfig() {
  return {
    base: (process.env.IMAGE_API_BASE || "").trim().replace(/\/+$/, ""),
    key: (process.env.IMAGE_API_KEY || "").trim(),
    model: (process.env.IMAGE_MODEL || "").trim() || DEFAULT_OPENAI_MODEL,
    size: (process.env.IMAGE_SIZE || "").trim() || DEFAULT_IMAGE_SIZE,
  };
}

function getPollinationsModel() {
  // IMAGE_MODEL 与 openai 共用：只有显式 IMAGE_PROVIDER=pollinations 时才允许自定义模型，
  // 避免 auto 无 key 或降级时误把 openai 模型名拼进 Pollinations URL。
  const custom = (process.env.IMAGE_MODEL || "").trim();
  if (getProviderSetting() === "pollinations" && custom) return custom;
  return DEFAULT_POLLINATIONS_MODEL;
}

export function getImageConfig() {
  const provider = getProviderSetting();
  const openai = getOpenaiConfig();
  const keyConfigured = Boolean(openai.key);
  const resolved =
    provider === "auto"
      ? keyConfigured && openai.base
        ? "openai"
        : "pollinations"
      : provider;
  const model = resolved === "openai" ? openai.model : getPollinationsModel();

  return {
    provider,
    resolved,
    model,
    keyConfigured,
    enabled: true,
  };
}

function normalizePrompt(value) {
  if (typeof value !== "string") {
    throw new ImageError(400, "图片描述太短", "PROMPT_INVALID");
  }

  const text = value.trim();
  if (text.length < MIN_PROMPT_CHARS) {
    throw new ImageError(400, "图片描述太短", "PROMPT_INVALID");
  }

  return text.length > MAX_PROMPT_CHARS ? text.slice(0, MAX_PROMPT_CHARS) : text;
}

function normalizeDimension(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_DIMENSION;
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(num)));
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

function normalizeSeed(value) {
  if (value === undefined || value === null || value === "") return randomSeed();
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return randomSeed();
  return Math.min(MAX_SEED, Math.max(0, num));
}

function sniffContentType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function assertImageSize(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new ImageError(502, "图片服务暂时不可用", "UPSTREAM_FAILED");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ImageError(502, "图片太大", "UPSTREAM_FAILED");
  }
}

function cacheKey(provider, model, prompt, seed, width, height) {
  return crypto
    .createHash("sha256")
    .update(`${provider}|${model}|${prompt}|${seed}|${width}x${height}`)
    .digest("hex");
}

function getCacheDir() {
  if (process.env.VERCEL) return null;
  const dir = (process.env.IMAGE_CACHE_DIR || "").trim() || DEFAULT_CACHE_DIR;
  return path.resolve(process.cwd(), dir);
}

const memoryCache = new Map();

function readMemoryCache(key) {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEMORY_CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  memoryCache.delete(key);
  memoryCache.set(key, hit);
  return hit;
}

function writeMemoryCache(key, entry) {
  memoryCache.delete(key);
  memoryCache.set(key, { at: Date.now(), ...entry });
  while (memoryCache.size > MEMORY_CACHE_LIMIT) {
    const oldest = memoryCache.keys().next().value;
    memoryCache.delete(oldest);
  }
}

function readDiskCache(dir, key) {
  if (!dir) return null;
  try {
    const file = path.join(dir, `${key}.bin`);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0) return null;
    const buffer = fs.readFileSync(file);
    if (buffer.length === 0) return null;
    return { buffer, contentType: sniffContentType(buffer) || "image/jpeg" };
  } catch {
    return null;
  }
}

function writeDiskCache(dir, key, entry) {
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key}.bin`), entry.buffer);
  } catch {
    // 磁盘缓存写失败不能影响主流程
  }
}

function lookupCache(key) {
  const memory = readMemoryCache(key);
  if (memory) {
    return { buffer: memory.buffer, contentType: memory.contentType };
  }

  const dir = getCacheDir();
  const disk = readDiskCache(dir, key);
  if (!disk) return null;
  writeMemoryCache(key, disk);
  return disk;
}

function rememberCache(key, entry) {
  writeMemoryCache(key, entry);
  writeDiskCache(getCacheDir(), key, entry);
}

let lastPollinationsAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestPollinationsOnce(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      signal: AbortSignal.timeout(POLLINATIONS_TIMEOUT_MS),
    });
  } catch {
    throw new ImageError(504, "图片服务连接超时", "TIMEOUT");
  }

  if (response.status === 402 || response.status === 429) {
    let text = "";
    try {
      text = await response.text();
    } catch {
      // 读取失败时按默认冷却时间处理
    }
    const match = /Retry after (\d+)s/i.exec(text);
    const headerValue = Number(response.headers.get("retry-after"));
    const retryAfter = match
      ? Number(match[1])
      : Number.isFinite(headerValue) && headerValue > 0
        ? Math.ceil(headerValue)
        : 45;
    throw new ImageError(
      429,
      `免费图片额度冷却中，约 ${retryAfter} 秒后再试`,
      "RATE_LIMITED",
      retryAfter,
    );
  }

  if (response.status >= 500) {
    try {
      await response.arrayBuffer(); // 读完占位响应，释放连接
    } catch {
      // 忽略，仅用于释放连接
    }
    return { retryable: true };
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (response.status === 200 && contentType.startsWith("image/")) {
    let buffer;
    try {
      buffer = Buffer.from(await response.arrayBuffer());
    } catch {
      throw new ImageError(504, "图片服务连接超时", "TIMEOUT");
    }
    assertImageSize(buffer);
    return {
      buffer,
      contentType: contentType.split(";")[0].trim() || "image/jpeg",
    };
  }

  throw new ImageError(502, "图片服务暂时不可用", "UPSTREAM_FAILED");
}

async function fetchPollinations({ prompt, seed, width, height }) {
  const elapsed = Date.now() - lastPollinationsAt;
  if (lastPollinationsAt && elapsed < POLLINATIONS_COOLDOWN_MS) {
    // 前端按 retryAfter 到点重试时可能差几十毫秒再次撞上窗口，这里多给 1 秒取整缓冲
    const retryAfter =
      Math.ceil((POLLINATIONS_COOLDOWN_MS - elapsed) / 1000) + 1;
    throw new ImageError(
      429,
      `免费图片额度冷却中，约 ${retryAfter} 秒后再试`,
      "RATE_LIMITED",
      retryAfter,
    );
  }

  const model = getPollinationsModel();
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&seed=${seed}` +
    `&nologo=true&model=${encodeURIComponent(model)}&private=true`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const outcome = await requestPollinationsOnce(url);
    if (outcome.buffer) {
      // 只有真正拿到图片才锚定限流窗口；失败/被本地拒绝的尝试不顺延窗口
      lastPollinationsAt = Date.now();
      return outcome;
    }
    if (attempt === 0) await sleep(POLLINATIONS_RETRY_DELAY_MS);
  }

  throw new ImageError(502, "图片服务暂时不可用", "UPSTREAM_FAILED");
}

async function postOpenaiGeneration(config, payload) {
  let response;
  try {
    response = await fetch(`${config.base}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${config.key}`,
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  } catch {
    throw new ImageError(504, "图片服务连接超时", "TIMEOUT");
  }

  let text = "";
  try {
    text = await response.text();
  } catch {
    throw new ImageError(504, "图片服务连接超时", "TIMEOUT");
  }

  return { status: response.status, headers: response.headers, text };
}

async function downloadImage(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(OPENAI_DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new ImageError(504, "图片服务连接超时", "TIMEOUT");
  }

  if (!response.ok) {
    throw new ImageError(502, "图片服务暂时不可用", "UPSTREAM_FAILED");
  }

  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new ImageError(504, "图片服务连接超时", "TIMEOUT");
  }

  assertImageSize(buffer);
  return { buffer, contentType: response.headers.get("content-type") || "" };
}

function parseOpenaiRetryAfter(headers, text) {
  const headerValue = Number(headers.get("retry-after"));
  if (Number.isFinite(headerValue) && headerValue > 0) {
    return Math.ceil(headerValue);
  }

  try {
    const body = JSON.parse(text);
    const value = Number(body?.retry_after ?? body?.error?.retry_after);
    if (Number.isFinite(value) && value > 0) return Math.ceil(value);
  } catch {
    // 解析失败按默认值处理
  }

  return 10;
}

async function fetchOpenai({ prompt }) {
  const config = getOpenaiConfig();
  if (!config.key) {
    throw new ImageError(500, "服务端还没有配置图片 API Key", "CONFIG_MISSING");
  }
  if (!config.base) {
    throw new ImageError(500, "服务端还没有配置图片 API Base", "CONFIG_MISSING");
  }

  const payload = {
    model: config.model,
    prompt,
    n: 1,
    size: config.size,
    response_format: "b64_json",
  };

  let result = await postOpenaiGeneration(config, payload);
  if (
    (result.status === 400 || result.status === 422) &&
    /response_format|b64_json/i.test(result.text)
  ) {
    const retryPayload = { model: config.model, prompt, n: 1, size: config.size };
    result = await postOpenaiGeneration(config, retryPayload);
  }

  if (result.status === 401 || result.status === 403) {
    throw new ImageError(502, "图片 API Key 无效或没有权限", "UPSTREAM_FAILED");
  }

  if (result.status === 429) {
    const retryAfter = parseOpenaiRetryAfter(result.headers, result.text);
    throw new ImageError(
      429,
      `图片生成频率超限，约 ${retryAfter} 秒后再试`,
      "RATE_LIMITED",
      retryAfter,
    );
  }

  if (result.status < 200 || result.status >= 300) {
    throw new ImageError(502, "图片服务暂时不可用", "UPSTREAM_FAILED");
  }

  let body;
  try {
    body = JSON.parse(result.text);
  } catch {
    throw new ImageError(502, "图片服务暂时不可用", "UPSTREAM_FAILED");
  }

  const first = Array.isArray(body?.data) ? body.data[0] : null;
  let buffer = null;
  let contentType = "";

  if (first && typeof first.b64_json === "string" && first.b64_json) {
    buffer = Buffer.from(first.b64_json, "base64");
  } else if (first && typeof first.url === "string" && first.url) {
    const downloaded = await downloadImage(first.url);
    buffer = downloaded.buffer;
    contentType = downloaded.contentType;
  }

  assertImageSize(buffer);
  return {
    buffer,
    contentType: sniffContentType(buffer) || contentType || "image/jpeg",
  };
}

async function runProvider(provider, { prompt, seed, width, height }) {
  const model = provider === "openai" ? getOpenaiConfig().model : getPollinationsModel();
  const key = cacheKey(provider, model, prompt, seed, width, height);

  const cached = lookupCache(key);
  if (cached) {
    return {
      buffer: cached.buffer,
      contentType: cached.contentType,
      provider,
      seed,
      cached: true,
    };
  }

  const entry =
    provider === "openai"
      ? await fetchOpenai({ prompt, seed, width, height })
      : await fetchPollinations({ prompt, seed, width, height });

  assertImageSize(entry.buffer);
  const finalEntry = {
    buffer: entry.buffer,
    contentType: sniffContentType(entry.buffer) || entry.contentType || "image/jpeg",
  };
  rememberCache(key, finalEntry);

  return { ...finalEntry, provider, seed, cached: false };
}

export async function generateImage({ prompt, seed, width, height } = {}) {
  const startedAt = Date.now();
  const normalizedPrompt = normalizePrompt(prompt);
  const normalizedWidth = normalizeDimension(width);
  const normalizedHeight = normalizeDimension(height);
  const normalizedSeed = normalizeSeed(seed);

  const provider = getProviderSetting();
  const openai = getOpenaiConfig();
  const useOpenaiFirst =
    provider === "openai" ||
    (provider === "auto" && Boolean(openai.key && openai.base));
  const primary = useOpenaiFirst ? "openai" : "pollinations";
  const canFallback = provider === "auto" && useOpenaiFirst;
  const params = {
    prompt: normalizedPrompt,
    seed: normalizedSeed,
    width: normalizedWidth,
    height: normalizedHeight,
  };

  let result;
  try {
    result = await runProvider(primary, params);
  } catch (err) {
    const fallbackAllowed =
      canFallback && err instanceof ImageError && FALLBACK_ERROR_CODES.includes(err.code);
    if (!fallbackAllowed) throw err;
    result = await runProvider("pollinations", params);
  }

  console.log(
    `[image] provider=${result.provider} status=200 ${Date.now() - startedAt}ms cached=${result.cached} bytes=${result.buffer.length}`,
  );

  return result;
}