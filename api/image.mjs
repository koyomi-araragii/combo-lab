import { generateImage } from "../lib/image.mjs";

export const config = {
  maxDuration: 60,
};

function parseBody(req) {
  const raw = req.body;
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  }
  if (Buffer.isBuffer(raw)) {
    const text = raw.toString("utf8");
    if (!text.trim()) return {};
    return JSON.parse(text);
  }
  if (typeof raw === "object") return raw;
  return {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  let body;
  try {
    body = parseBody(req);
  } catch {
    return res
      .status(400)
      .json({ error: { message: "请求体不是合法 JSON", code: "BAD_REQUEST" } });
  }

  try {
    const result = await generateImage(body);
    res.status(200);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Image-Provider", result.provider);
    res.setHeader("X-Image-Seed", String(result.seed));
    return res.send(Buffer.from(result.buffer));
  } catch (err) {
    const status = err.status || 502;
    const error = {
      message: err.message || "图片生成失败",
      code: err.code || "UPSTREAM_FAILED",
    };
    if (err.retryAfter !== undefined && err.retryAfter !== null) {
      error.retryAfter = err.retryAfter;
    }
    if (status === 429 && error.retryAfter) {
      res.setHeader("Retry-After", String(error.retryAfter));
    }
    return res.status(status).json({ error });
  }
}