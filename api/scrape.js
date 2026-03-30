import cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const url = "https://id.ngomik.cloud/manga/?order=update";

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://id.ngomik.cloud/"
      }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];

    $(".listupd .bs").each((i, el) => {
      const a = $(el).find(".bsx > a").first();

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

      results.push({
        title,
        link,
        img,
        chapter,
        rating,
        type
      });
    });

    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
