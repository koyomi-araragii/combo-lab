# 万物合成实验室 · Combo Lab

把两个元素合成一个新物种的 AI 小游戏。输入「猫 + 吉他」，看看会得到什么。

当前仓库是**最终改版**：新的卡片式界面、拖拽/点选交互、图片彩蛋、随机炼金流派，以及西电/高校梗。

## 结构

- `combo-lab.html` — 最终版前端页面
- `assets/` — 彩蛋与预设图片（西电、上交、清华、成电、西小电、斩杀、奶蛙、塔菲）
- `server.mjs` — 本地开发用 Node 代理，解决浏览器 CORS，并托管 `assets/`
- `api/chat/completions.mjs` — Vercel Function，线上转发到 OpenCode Go（文本）
- `api/health.mjs` — 健康检查，确认服务端是否已配置 Key
- `api/image.mjs` / `lib/image.mjs` — 保留的原版图片生成接口（当前最终版前端不调用，作为可选能力保留）
- `lib/opencode.mjs` — 本地和线上共用的文本模型调用逻辑

默认文本模型：`deepseek-v4.1-flash`（OpenCode Go）。

## 彩蛋

最终版保留了以下彩蛋组合：

- 猫 + 鱼 → 猫鱼
- 西电 + 咖啡 → 早八续命液
- 黑客松 + 熬夜 → 肝帝
- 猫 + 微波炉 → 微波猫
- 键盘 + 咖啡 → 程序员
- 月亮 + 蛋糕 → 月亮月饼
- 雪 + 佛 → 雪中送佛
- 上交 + 西电 → 浦江到渭水（图片彩蛋）
- 清华 + 西电 → 五五开定理（图片彩蛋）
- 成电 + 西电 → 电子科技大学·双子星（图片彩蛋）
- 奶蛙 + 西小电 → 思考蛙（图片彩蛋）
- 斩杀 + 西小电 → 低分凝视（图片彩蛋）
- 塔菲 + 西电 → 三十亿校徽（图片彩蛋）

## 本地运行

1. 安装 Node.js 20 或更高版本。
2. 确认 `.env` 中已填入真实的 `OPENCODE_API_KEY`（不要提交到 Git）。
3. 双击 `start.bat`，或运行：

   ```bash
   npm start
   ```

4. 浏览器打开 <http://127.0.0.1:8787>。

不要直接双击 `combo-lab.html`，浏览器的 CORS 限制会阻止它直接调用模型接口。

## 部署到 Vercel

1. 把仓库导入 Vercel。
2. 在项目的 **Settings → Environment Variables** 添加：

   ```text
   OPENCODE_API_KEY=oc_sk_...
   ```

3. 重新部署，或直接部署当前代码。

可选环境变量：

```text
OPENCODE_MODEL=deepseek-v4.1-flash
OPENCODE_API_BASE=https://opencode.ai/inference/go/openai/v1
OPENCODE_MAX_TOKENS=1500
OPENCODE_SESSION_ID=combo-lab
```
## 尝试一些吧！

https://combo-lab-eta.vercel.app/

## 安全说明

- 真实 Key 只放在 `.env` 和 Vercel 环境变量中，不提交到 Git。
- `.env` 已被 `.gitignore` 和 `.vercelignore` 忽略。
- `combo-lab/`、`.cache/`、`.preview/` 是本地源/缓存目录，不会进入仓库或部署。
- 如果 Key 曾经出现在公开代码、截图或聊天记录里，建议在 OpenCode Console 里轮换一个新 Key。
- 公开部署后 `/api/chat/completions` 和 `/api/image` 都可以被任何人调用；如果担心额度被滥用，可以在 Vercel 控制台配置防火墙/限流规则。
