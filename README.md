# 万物合成实验室 · Combo Lab

把两个元素合成一个新物种的 AI 小游戏。输入「猫 + 吉他」，看看会得到什么。

## 结构

- `combo-lab.html` — 前端页面（静态）
- `server.mjs` — 本地开发用的 Node 代理，解决浏览器 CORS
- `api/chat/completions.mjs` — Vercel Function，线上转发到 OpenCode Go
- `api/health.mjs` — 健康检查，确认服务端是否已配置 Key
- `lib/opencode.mjs` — 本地和线上共用的模型调用逻辑

默认模型：`deepseek-v4.1-flash`（OpenCode Go）。

## 本地运行

1. 安装 Node.js 20 或更高版本。
2. 复制 `.env.example` 为 `.env`，填入真实的 `OPENCODE_API_KEY`。
3. 双击 `start.bat`，或者在终端运行：

   ```bash
   npm start
   ```

4. 浏览器打开 <http://127.0.0.1:8787>。

不要直接双击 `combo-lab.html`，因为浏览器的 CORS 限制会阻止它直接调用模型接口。

## 部署到 Vercel

1. 把仓库导入 Vercel。
2. 在项目的 **Settings → Environment Variables** 添加：

   ```text
   OPENCODE_API_KEY=oc_sk_...
   ```

3. 重新部署，或者直接部署当前代码。

可选环境变量：

```text
OPENCODE_MODEL=deepseek-v4.1-flash
OPENCODE_API_BASE=https://opencode.ai/inference/go/openai/v1
OPENCODE_MAX_TOKENS=1500
OPENCODE_SESSION_ID=combo-lab
```

## 安全说明

- 真实 Key 只放在 `.env` 和 Vercel 环境变量中，不提交到 Git。
- `.env` 已被 `.gitignore` 和 `.vercelignore` 忽略。
- 如果 Key 曾经出现在公开代码、截图或聊天记录里，建议在 OpenCode Console 里轮换一个新的 Key。
- 公开部署后 `/api/chat/completions` 可以被任何人调用；如果担心额度被滥用，可以在 Vercel 控制台给该接口配置防火墙/限流规则。
