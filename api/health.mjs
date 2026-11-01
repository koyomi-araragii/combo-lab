import { getApiBase, getModel, keyConfigured } from "../lib/opencode.mjs";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  return res.status(200).json({
    ok: true,
    keyConfigured: keyConfigured(),
    apiBase: getApiBase(),
    model: getModel(),
  });
}
