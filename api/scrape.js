import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const url = "https://id.ngomik.cloud/manga/?order=update";

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://id.ngomik.cloud/",
        "Accept": "text/html"
      }
    });

    if (!response.ok) {
      return res.status(500).json({
        error: "Failed fetch",
        status: response.status
      });
    }

    const html = await response.text();

    if (!html || html.length < 100) {
      return res.status(500).json({
        error: "HTML kosong / kena block"
      });
    }

    const $ = cheerio.load(html);

    const results = [];

    $(".listupd .bs").each((i, el) => {
      const a = $(el).find(".bsx > a").first();

      if (!a.length) return;

      const title =
        a.attr("title") ||
        a.find(".tt").text().trim();

      const link = a.attr("href");

      const img =
        a.find("img").attr("data-pagespeed-lazy-src") ||
        a.find("img").attr("data-src") ||
        a.find("img").attr("src");

      const chapter = a.find(".epxs").text().trim();
      const rating = a.find(".numscore").text().trim();
      const type = a.find(".type").text().trim();

      if (title && link) {
        results.push({
          title,
          link,
          img,
          chapter,
          rating,
          type
        });
      }
    });

    // 🔥 penting: biar gak "Empty"
    if (results.length === 0) {
      return res.status(200).json({
        message: "Selector tidak menemukan data",
        debug: "Cek HTML berubah atau kena Cloudflare"
      });
    }

    return res.status(200).json(results);

  } catch (err) {
    return res.status(500).json({
      error: err.message,
      hint: "Kemungkinan cheerio tidak ter-load"
    });
  }
}