// api/image.js - Image proxy dengan caching

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  // Security: whitelist domains
  const allowedDomains = [
    'image.softkomik.com',
    'softkomik.co',
    'cdn.softkomik.co',
    'images.softkomik.co'
  ];

  try {
    const urlObj = new URL(url);
    if (!allowedDomains.some(domain => urlObj.hostname.includes(domain))) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const imageRes = await fetch(url, {
      headers: {
        'Referer': 'https://softkomik.co/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*;q=0.8',
      },
      timeout: 10000
    });

    if (!imageRes.ok) {
      throw new Error(`HTTP ${imageRes.status}`);
    }

    const contentType = imageRes.headers.get('content-type');
    
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const buffer = await imageRes.arrayBuffer();
    res.end(Buffer.from(buffer));

  } catch (error) {
    console.error('Image proxy error:', error.message);
    
    const errorPng = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0,
      0, 10, 73, 68, 65, 84, 8, 153, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10,
      45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
    ]);
    
    res.setHeader('Content-Type', 'image/png');
    res.status(500);
    res.end(errorPng);
  }
}
