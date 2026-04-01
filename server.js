import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// Optional: batasi domain tujuan agar tidak jadi open proxy.
// Isi contoh: ALLOWED_HOSTS=example.com,static.example.com,cdn.example.net
const allowedHosts = (process.env.ALLOWED_HOSTS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function isAllowedTarget(url) {
  if (!allowedHosts.length) return true;
  return allowedHosts.includes(url.hostname);
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

app.options("*", (req, res) => {
  setCors(res);
  res.status(204).end();
});

// Proxy utama: /proxy?url=https://contoh.com/file.jpg
app.get("/proxy", async (req, res) => {
  setCors(res);

  const target = req.query.url;
  if (!target || typeof target !== "string") {
    return res.status(400).json({ error: "Query parameter 'url' wajib diisi" });
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    return res.status(400).json({ error: "URL tidak valid" });
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return res.status(400).json({ error: "Hanya http/https yang diizinkan" });
  }

  if (!isAllowedTarget(url)) {
    return res.status(403).json({ error: "Host tidak diizinkan" });
  }

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Railway Proxy)",
        "Accept": req.get("accept") || "*/*"
      }
    });

    // Salin status code
    res.status(upstream.status);

    // Salin header penting saja
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) res.setHeader("Cache-Control", cacheControl);

    // Tambahan agar browser tidak memblokir
    setCors(res);

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return res.send(text || `Upstream error: ${upstream.status}`);
    }

    // Stream langsung
    if (!upstream.body) {
      return res.status(502).send("Tidak ada body dari upstream");
    }

    return upstream.body.pipe(res);
  } catch (err) {
    return res.status(502).json({
      error: "Gagal mengambil target",
      detail: String(err?.message || err)
    });
  }
});

// Endpoint cek hidup
app.get("/", (req, res) => {
  setCors(res);
  res.type("text").send("OK");
});

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
