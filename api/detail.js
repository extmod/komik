import cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "url required" });

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://id.ngomik.cloud/"
      }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $(".entry-title").text().trim();
    const cover = $(".thumb img").attr("src");

    let chapters = [];
    $(".cl li").each((i, el) => {
      const chTitle = $(el).find("a").text().trim();
      const chLink = $(el).find("a").attr("href");

      chapters.push({ chTitle, chLink });
    });

    res.status(200).json({ title, cover, chapters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
