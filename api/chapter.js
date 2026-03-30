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

    let images = [];

    $("#readerarea img").each((i, el) => {
      const img =
        $(el).attr("data-src") ||
        $(el).attr("src");

      if (img) images.push(img);
    });

    res.status(200).json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
