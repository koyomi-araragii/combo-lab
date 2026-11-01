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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_FILE = path.join(__dirname, "combo-lab.html");
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

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      keyConfigured: keyConfigured(),
      apiBase: getApiBase(),
      model: getModel(),
    });
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
