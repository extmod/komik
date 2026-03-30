// api/scrape.js — Softkomik scraper (Next.js RSC + custom API)

import axios from 'axios';

const BASE_URL = 'https://softkomik.co';
const API_URL  = 'https://v2.softdevices.my.id';
const COVER_URL = 'https://cover.softdevices.my.id/softkomik-cover';
const IMAGE_BASE_URL = 'https://cd1.softkomik.online/softkomik';
const CDN_FALLBACKS = [
  'https://psy1.komik.im',
  'https://image.komik.im/softkomik',
  'https://f1.softkomik.com/file/softkomik-image',
  'https://img.softdevices.my.id/softkomik-image',
];

// ── Cache ────────────────────────────────────────────────────────
const _cache = new Map();
const cacheGet = (k) => {
  const item = _cache.get(k);
  if (!item || Date.now() > item.exp) { _cache.delete(k); return null; }
  return item.v;
};
const cacheSet = (k, v, ttl = 3600) =>
  _cache.set(k, { v, exp: Date.now() + ttl * 1000 });

// ── Session ──────────────────────────────────────────────────────
let _session = null;

async function getSession() {
  if (_session && _session.ex > Date.now()) return _session;

  const res = await axios.get(`${BASE_URL}/api/sessions`, {
    headers: unauthHeaders(`${BASE_URL}/`),
    timeout: 12000,
  });

  // /api/sessions mengembalikan { token, sign, ex }
  // 'ex' bisa dalam detik (Unix) atau milidetik — normalkan ke ms
  const raw = res.data;
  if (!raw?.token || !raw?.sign) {
    throw new Error(`Session invalid: ${JSON.stringify(raw).slice(0, 200)}`);
  }

  // Normalisasi expiry ke milliseconds
  const ex = raw.ex < 1e12 ? raw.ex * 1000 : raw.ex;
  _session = { token: raw.token, sign: raw.sign, ex };
  return _session;
}

// ── Headers ──────────────────────────────────────────────────────
function unauthHeaders(referer = `${BASE_URL}/`) {
  return {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': BASE_URL,
    'Referer': referer,
  };
}

async function authHeaders(referer = `${BASE_URL}/`) {
  const sess = await getSession();
  return {
    ...unauthHeaders(referer),
    'X-Token': sess.token,
    'X-Sign': sess.sign,
  };
}

function rscHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/x-component, */*',
    'Referer': `${BASE_URL}/`,
    'rsc': '1',               // ← kunci Next.js RSC
    'Next-Router-State-Tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D',
  };
}

// ── Rate Limit ────────────────────────────────────────────────────
const _rl = new Map();
function checkRateLimit(ip, limit = 30, windowSec = 60) {
  const now = Date.now();
  const reqs = (_rl.get(ip) || []).filter(t => now - t < windowSec * 1000);
  if (reqs.length >= limit) return false;
  _rl.set(ip, [...reqs, now]);
  return true;
}

// ── API Calls ─────────────────────────────────────────────────────

async function searchManga(query, page = 1) {
  if (!query || query.length < 2) throw new Error('Query minimal 2 karakter');

  const cKey = `search:${query.toLowerCase()}:${page}`;
  const hit  = cacheGet(cKey);
  if (hit) return hit;

  const url = new URL(`${API_URL}/komik`);
  url.searchParams.set('name', query);
  url.searchParams.set('search', 'true');
  url.searchParams.set('limit', '20');
  url.searchParams.set('page', String(page));

  const res = await axios.get(url.toString(), {
    headers: unauthHeaders(`${BASE_URL}/`),
    timeout: 12000,
  });

  const lib = res.data;
  if (!lib?.data) throw new Error('Response search tidak valid: ' + JSON.stringify(lib).slice(0, 200));

  const result = {
    data: lib.data.map(m => ({
      id:    m.title_slug,
      title: m.title,
      cover: `${COVER_URL}/${m.gambar?.replace(/^\//, '') || ''}`,
      url:   `${BASE_URL}/${m.title_slug}`,
      type:  m.type,
      status: m.status,
    })),
    page:    lib.page ?? 1,
    maxPage: lib.maxPage ?? 1,
    hasMore: (lib.page ?? 1) < (lib.maxPage ?? 1),
  };

  cacheSet(cKey, result, 1800);
  return result;
}

async function getLibrary(page = 1, params = {}) {
  const { sortBy = 'popular', status, type, genre, min } = params;
  const cKey = `lib:${page}:${JSON.stringify(params)}`;
  const hit  = cacheGet(cKey);
  if (hit) return hit;

  // RSC request ke /komik/library — sama seperti popularMangaRequest
  const url = new URL(`${BASE_URL}/komik/library`);
  url.searchParams.set('sortBy', sortBy);
  url.searchParams.set('page', String(page));
  if (status) url.searchParams.set('status', status);
  if (type)   url.searchParams.set('type', type);
  if (genre)  url.searchParams.set('genre', genre);
  if (min && min !== '0') url.searchParams.set('min', min);

  const res = await axios.get(url.toString(), {
    headers: rscHeaders(),
    timeout: 15000,
  });

  // RSC payload — ekstrak JSON dari stream
  const lib = extractFromRsc(res.data, 'data');
  if (!lib?.data) {
    // Debug: log snippet RSC
    const snippet = (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)).slice(0, 1000);
    console.error('[library] RSC snippet:', snippet);
    throw new Error('Tidak bisa parse library dari RSC payload');
  }

  const result = {
    data: lib.data.map(m => ({
      id:    m.title_slug,
      title: m.title,
      cover: `${COVER_URL}/${m.gambar?.replace(/^\//, '') || ''}`,
      url:   `${BASE_URL}/${m.title_slug}`,
      type:  m.type,
      status: m.status,
    })),
    page:    lib.page ?? 1,
    maxPage: lib.maxPage ?? 1,
    hasMore: (lib.page ?? 1) < (lib.maxPage ?? 1),
  };

  cacheSet(cKey, result, 600);
  return result;
}

async function getMangaDetails(slug) {
  const cKey = `manga:${slug}`;
  const hit  = cacheGet(cKey);
  if (hit) return hit;

  const hdrs = await authHeaders(`${BASE_URL}/${slug}`);
  let res;
  try {
    res = await axios.get(`${API_URL}/komik/${slug}`, { headers: hdrs, timeout: 12000 });
  } catch (e) {
    if (e.response?.status === 401) {
      _session = null; // Invalidate dan retry
      const hdrs2 = await authHeaders(`${BASE_URL}/${slug}`);
      res = await axios.get(`${API_URL}/komik/${slug}`, { headers: hdrs2, timeout: 12000 });
    } else throw e;
  }

  const m = res.data;
  const result = {
    id:          slug,
    title:       m.title,
    author:      m.author,
    description: m.sinopsis,
    genres:      m.Genre || [],
    status:      m.status,
    type:        m.type,
    cover:       `${COVER_URL}/${(m.gambar || '').replace(/^\//, '')}`,
    url:         `${BASE_URL}/${slug}`,
    rating:      m.rating,
    totalChapters: m.totalChapter,
  };

  cacheSet(cKey, result, 3600);
  return result;
}

async function getChapters(slug) {
  const cKey = `chapters:${slug}`;
  const hit  = cacheGet(cKey);
  if (hit) return hit;

  // unauthHeaders — persis seperti di Mihon (chapter endpoint tidak butuh auth)
  const res = await axios.get(
    `${API_URL}/komik/${slug}/chapter?limit=9999999`,
    { headers: unauthHeaders(`${BASE_URL}/${slug}`), timeout: 15000 },
  );

  const dto = res.data;
  if (!dto?.chapter) {
    throw new Error('Chapter list invalid: ' + JSON.stringify(dto).slice(0, 200));
  }

  const chapters = dto.chapter.map(ch => {
    const raw = String(ch.chapter).trim();
    const num = parseFloat(raw.replace(',', '.')) || -1;
    return {
      id:     raw,
      title:  `Chapter ${fmtChapter(raw)}`,
      number: num,
      url:    `/${slug}/chapter/${raw}`,
    };
  }).sort((a, b) => b.number - a.number);

  cacheSet(cKey, chapters, 1800);
  return chapters;
}

async function getChapterImages(mangaSlug, chapterNum) {
  const cKey = `chapter:${mangaSlug}:${chapterNum}`;
  const hit  = cacheGet(cKey);
  if (hit) return hit;

  const pageUrl = `${BASE_URL}/${mangaSlug}/chapter/${chapterNum}`;
  const res = await axios.get(pageUrl, {
    headers: rscHeaders(),
    timeout: 20000,
  });

  const rscRaw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

  // Cari imageSrc array di RSC payload
  const imageSrc = extractImageSrc(rscRaw);

  if (!imageSrc || imageSrc.length === 0) {
    // Debug: log snippet
    console.error('[chapter] RSC snippet (2000 chars):', rscRaw.slice(0, 2000));
    throw new Error(`Tidak ada gambar di chapter ${chapterNum}. Cek server logs untuk RSC snippet.`);
  }

  const images = imageSrc.map((img, i) => ({
    page: i + 1,
    url:  `${IMAGE_BASE_URL}/${img.replace(/^\//, '')}`,
  }));

  const result = { mangaSlug, chapterNum, images, totalPages: images.length };
  cacheSet(cKey, result, 1800);
  return result;
}

// ── RSC Parsers ───────────────────────────────────────────────────

function extractImageSrc(rscText) {
  // Pattern 1: "imageSrc":["path","path",...]
  const m1 = rscText.match(/"imageSrc"\s*:\s*(\[[\s\S]*?\])/);
  if (m1) {
    try { return JSON.parse(m1[1]); } catch (_) {}
  }

  // Pattern 2: array of image paths setelah kata "imageSrc"
  const m2 = rscText.match(/imageSrc[^[]*(\[[\s\S]*?\])/);
  if (m2) {
    try { return JSON.parse(m2[1]); } catch (_) {}
  }

  // Pattern 3: URL gambar langsung (fallback)
  const urls = [...rscText.matchAll(/"(\/[^"]*\.(jpg|jpeg|png|webp))"/gi)].map(m => m[1]);
  return [...new Set(urls)];
}

function extractFromRsc(rscData, hint = '') {
  const text = typeof rscData === 'string' ? rscData : JSON.stringify(rscData);

  // RSC baris-per-baris — cari baris yang mengandung JSON object besar
  const lines = text.split('\n');
  for (const line of lines) {
    // Format RSC: "N:DATA" atau hanya JSON
    const cleaned = line.replace(/^\d+:/, '').trim();
    if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(cleaned);
      // Jika ada hint, cari object yang punya property itu
      if (hint && parsed[hint] !== undefined) return parsed;
      if (!hint) return parsed;
    } catch (_) {}
  }

  // Coba extract JSON terbesar dari seluruh payload
  const jsonBlocks = [...text.matchAll(/\{[^{}]{100,}\}/g)];
  for (const block of jsonBlocks.reverse()) {
    try {
      const p = JSON.parse(block[0]);
      if (!hint || p[hint] !== undefined) return p;
    } catch (_) {}
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────────────────
function fmtChapter(raw) {
  const n = parseFloat(raw.replace(',', '.'));
  if (isNaN(n)) return raw;
  return n === Math.floor(n) ? String(Math.floor(n)) : String(n);
}

// ── Main Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '127.0.0.1';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Rate limit: max 30 req/menit' });

  const { action, query, page, mangaId, chapterId, sortBy, status, type, genre, min } = req.query;

  try {
    let result;
    switch (action) {
      case 'search':
        result = await searchManga(query, parseInt(page) || 1);
        break;
      case 'library':
        result = await getLibrary(parseInt(page) || 1, { sortBy, status, type, genre, min });
        break;
      case 'manga':
        result = await getMangaDetails(query);
        break;
      case 'chapters':
        result = await getChapters(query);
        break;
      case 'chapter':
        result = await getChapterImages(mangaId, chapterId);
        break;

      // ── Debug endpoint — hapus di production ──
      case 'debug-session':
        const sess = await getSession();
        result = { token: sess.token.slice(0, 8) + '...', sign: sess.sign.slice(0, 8) + '...', ex: sess.ex };
        break;
      case 'debug-rsc':
        const rscRes = await axios.get(`${BASE_URL}/komik/library`, {
          headers: rscHeaders(), timeout: 15000,
        });
        const snippet = (typeof rscRes.data === 'string' ? rscRes.data : JSON.stringify(rscRes.data)).slice(0, 3000);
        result = { snippet, contentType: rscRes.headers['content-type'] };
        break;

      default:
        return res.status(400).json({ error: `Action '${action}' tidak valid` });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error(`[scrape:${action}]`, err.message);
    if (err.response?.status === 401) _session = null;

    const msg =
      err.response?.status === 401 ? 'Session expired — coba lagi' :
      err.response?.status === 403 ? 'Akses diblokir Cloudflare' :
      err.response?.status === 404 ? 'Konten tidak ditemukan' :
      err.code === 'ENOTFOUND'     ? 'DNS tidak bisa di-resolve' :
      err.code === 'ETIMEDOUT'     ? 'Request timeout' :
      err.message;

    return res.status(err.response?.status || 500).json({
      error: msg,
      action,
      hint: 'Cek Vercel logs untuk detail lebih lanjut',
    });
  }
}
