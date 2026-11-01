import { chatCompletion } from "../../lib/opencode.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  try {
    const result = await chatCompletion(req.body);
    res.status(result.status);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "no-store");
    return res.send(result.text);
  } catch (err) {
    const status = err.status || 502;
    return res.status(status).json({ error: { message: err.message } });
  }
}
