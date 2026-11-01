import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import {
  chatCompletion,
  getApiBase,
  getModel,
  keyConfigured,
} from "./lib/opencode.mjs";
import { generateImage, getImageConfig } from "./lib/image.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_FILE = path.join(__dirname, "combo-lab.html");
const ASSETS_DIR = path.join(__dirname, "assets");
const PORT = Number(process.env.PORT) || 8787;
const HOST = "127.0.0.1";

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("请求体太大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (
    req.method === "GET" &&
    (url.pathname === "/" || url.pathname === "/combo-lab.html")
  ) {
    try {
      const html = fs.readFileSync(HTML_FILE, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("找不到 combo-lab.html");
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
    const mime = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    let rel;
    try {
      rel = decodeURIComponent(url.pathname.slice("/assets/".length));
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }
    const file = path.resolve(ASSETS_DIR, rel);
    if (!file.startsWith(ASSETS_DIR + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    try {
      const buffer = fs.readFileSync(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": buffer.length,
        "Cache-Control": "public, max-age=3600",
      });
      res.end(buffer);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      keyConfigured: keyConfigured(),
      apiBase: getApiBase(),
      model: getModel(),
      image: getImageConfig(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/image") {
    try {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        sendJson(res, 400, {
          error: { message: "请求体不是合法 JSON", code: "BAD_REQUEST" },
        });
        return;
      }

      const result = await generateImage(body);
      res.writeHead(200, {
        "Content-Type": result.contentType,
        "Content-Length": Buffer.byteLength(result.buffer),
        "Cache-Control": "public, max-age=86400",
        "X-Image-Provider": result.provider,
        "X-Image-Seed": String(result.seed),
      });
      res.end(result.buffer);
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
      console.error("[image error]", error.code, error.message);
      sendJson(res, status, { error });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/completions") {
    try {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        sendJson(res, 400, { error: { message: "请求体不是合法 JSON" } });
        return;
      }

      const result = await chatCompletion(body);
      res.writeHead(result.status, {
        "Content-Type": result.contentType,
        "Cache-Control": "no-store",
      });
      res.end(result.text);
    } catch (err) {
      const status = err.status || 502;
      console.error("[proxy error]", err.message);
      sendJson(res, status, { error: { message: err.message } });
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用，请先关闭占用它的程序。`);
  } else {
    console.error("启动失败：", err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log("");
  console.log("  万物合成实验室已启动");
  console.log(`  打开：${url}`);
  console.log(`  API Key：${keyConfigured() ? "已配置" : "未配置（请在 .env 中设置 OPENCODE_API_KEY）"}`);
  console.log("  按 Ctrl+C 停止");
  console.log("");

  if (!process.env.NO_OPEN) {
    const command =
      process.platform === "win32"
        ? `start "" "${url}"`
        : process.platform === "darwin"
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    exec(command, () => {});
  }
});
