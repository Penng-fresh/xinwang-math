export default async function handler(req, res) {
  const s = Math.min(Number((req.query && req.query.s) || 30), 240);
  const t = Date.now();
  await new Promise(r => setTimeout(r, s * 1000));
  return res.status(200).json({ slept: s, elapsedMs: Date.now() - t });
}
