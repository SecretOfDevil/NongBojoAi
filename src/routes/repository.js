const express = require("express");
const { requireApiKey } = require("../middleware/auth");

const router = express.Router();
const MAX_FILES = 40;
const MAX_FILE_BYTES = 40 * 1024;
const MAX_CONTEXT_CHARS = 180000;
const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|woff2?|ttf|eot|mp4|mov|mp3|wav|ico|lock)$/i;

function parseGithubUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0].startsWith(".") || parts[1].startsWith(".")) return null;
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}

async function githubJson(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "claude-proxy" },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub API error (${response.status})`);
  return data;
}

router.post("/repository/context", requireApiKey, async (req, res, next) => {
  try {
    const parsed = parseGithubUrl(String(req.body?.url || "").trim());
    if (!parsed) return res.status(400).json({ error: "รองรับเฉพาะลิงก์ GitHub repository แบบ public และต้องเป็น https เท่านั้น" });
    const repoPath = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
    const repo = await githubJson(repoPath);
    if (repo.private) return res.status(403).json({ error: "รองรับเฉพาะ public repository" });
    const tree = await githubJson(`${repoPath}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`);
    if (tree.truncated) return res.status(413).json({ error: "repository ใหญ่เกินไป กรุณาใช้ repository ที่เล็กลง" });

    const files = tree.tree.filter((item) => item.type === "blob" && item.size <= MAX_FILE_BYTES && !SKIP_EXTENSIONS.test(item.path)).slice(0, MAX_FILES);
    let usedChars = 0;
    const sections = [];
    for (const file of files) {
      if (usedChars >= MAX_CONTEXT_CHARS) break;
      const response = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/${encodeURIComponent(repo.default_branch)}/${file.path.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const text = await response.text();
      if (/\u0000/.test(text)) continue;
      const content = text.slice(0, Math.min(text.length, MAX_CONTEXT_CHARS - usedChars));
      sections.push(`===== ${file.path} =====\n${content}`);
      usedChars += content.length;
    }
    if (!sections.length) return res.status(422).json({ error: "ไม่พบไฟล์ข้อความที่อ่านได้ใน repository นี้" });
    res.json({ repository: `${parsed.owner}/${parsed.repo}`, branch: repo.default_branch, files: sections.length, truncated: files.length > sections.length || usedChars >= MAX_CONTEXT_CHARS, context: sections.join("\n\n") });
  } catch (error) { next(error); }
});

module.exports = router;