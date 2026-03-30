import cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const url = "https://id.ngomik.cloud/manga/?order=update";

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": url
      }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    let results = [];

    $(".listupd .bs").each((i, el) => {
      const title = $(el).find(".tt").text().trim();
      const link = $(el).find("a").attr("href");
      const img =
        $(el).find("img").attr("data-src") ||
        $(el).find("img").attr("src");

      results.push({ title, link, img });
    });

    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
