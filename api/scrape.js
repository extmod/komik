// api/scrape.js — Rewrite berdasarkan kode Mihon Softkomik extension

import axios from 'axios';

const BASE_URL = 'https://softkomik.co';
const API_URL = 'https://v2.softdevices.my.id';
const COVER_URL = 'https://cover.softdevices.my.id/softkomik-cover';
const IMAGE_BASE_URL = 'https://cd1.softkomik.online/softkomik';

// Simple in-memory cache
const cache = new Map();
function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) { cache.delete(key); return null; }
  return item.value;
}
function cacheSet(key, value, ttl = 3600) {
  cache.set(key, { value, expires: Date.now() + ttl * 1000 });
}

// Session cache — sama seperti @Volatile di Kotlin
let sessionCache = null;

// ─── Session Management ───────────────────────────────────────────

async function getSession() {
  // Cek apakah session masih valid (ex = expiry timestamp dalam ms)
  if (sessionCache && sessionCache.ex > Date.now()) {
    return sessionCache;
  }

  // Hit /api/sessions — sama persis seperti getSession() di Kotlin
  const response = await axios.get(`${BASE_URL}/api/sessions`, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/`,
    },
    timeout: 10000,
  });

  sessionCache = response.data;
  return sessionCache;
}

// Headers dengan auth token — untuk endpoint API yang butuh auth
async function authHeaders(referer = `${BASE_URL}/`) {
  const sess = await getSession();
  return {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': BASE_URL,
    'Referer': referer,
    'X-Token': sess.token,
    'X-Sign': sess.sign,
  };
}

// Headers tanpa auth — untuk chapter list dan search
function unauthHeaders(referer = `${BASE_URL}/`) {
  return {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': BASE_URL,
    'Referer': referer,
  };
}

// ─── API Functions ────────────────────────────────────────────────

async function searchManga(query, page = 1) {
  if (!query || query.length < 2) throw new Error('Query minimal 2 karakter');

  const cacheKey = `search:${query.toLowerCase()}:${page}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Persis seperti searchMangaRequest() di Kotlin
  // GET $apiUrl/komik?name=QUERY&search=true&limit=20&page=PAGE
  const url = new URL(`${API_URL}/komik`);
  url.searchParams.set('name', query);
  url.searchParams.set('search', 'true');
  url.searchParams.set('limit', '20');
  url.searchParams.set('page', page.toString());

  const response = await axios.get(url.toString(), {
    headers: unauthHeaders(`${BASE_URL}/`),
    timeout: 10000,
  });

  // Response: LibDataDto { data: [...], page: N, maxPage: N }
  const libData = response.data;
  if (!libData?.data) throw new Error('Format response tidak valid');

  const results = libData.data.map(manga => ({
    id: manga.title_slug,
    title: manga.title,
    cover: `${COVER_URL}/${manga.gambar.replace(/^\//, '')}`,
    url: `${BASE_URL}/${manga.title_slug}`,
  }));

  const result = {
    data: results,
    page: libData.page,
    maxPage: libData.maxPage,
    hasMore: libData.page < libData.maxPage,
  };

  cacheSet(cacheKey, result, 1800);
  return result;
}

async function getMangaDetails(slug) {
  const cacheKey = `manga:${slug}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Persis seperti mangaDetailsRequest() — menggunakan auth headers
  const headers = await authHeaders(`${BASE_URL}/`);
  const response = await axios.get(`${API_URL}/komik/${slug}`, {
    headers,
    timeout: 10000,
  });

  const manga = response.data;

  const result = {
    id: slug,
    title: manga.title,
    author: manga.author,
    description: manga.sinopsis,
    genres: manga.Genre || [],
    status: manga.status,
    cover: `${COVER_URL}/${(manga.gambar || '').replace(/^\//, '')}`,
    url: `${BASE_URL}/${slug}`,
  };

  cacheSet(cacheKey, result, 3600);
  return result;
}

async function getChapters(slug) {
  const cacheKey = `chapters:${slug}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Persis seperti chapterListRequest() di Kotlin:
  // GET $apiUrl/komik/$slug/chapter?limit=9999999
  // Pakai unauthHeaders, bukan auth!
  const response = await axios.get(
    `${API_URL}/komik/${slug}/chapter?limit=9999999`,
    {
      headers: unauthHeaders(`${BASE_URL}/${slug}`),
      timeout: 15000,
    }
  );

  // ChapterListDto { chapter: [{ chapter: "1" }, ...] }
  const dto = response.data;
  if (!dto?.chapter) throw new Error('Format chapter list tidak valid');

  const chapters = dto.chapter.map(ch => {
    const raw = ch.chapter.trim();
    const num = parseFloat(raw.replace(',', '.')) || -1;
    return {
      id: raw,
      title: `Chapter ${formatChapterNumber(raw)}`,
      number: num,
      url: `/${slug}/chapter/${raw}`,
    };
  }).sort((a, b) => b.number - a.number); // descending seperti di Kotlin

  cacheSet(cacheKey, chapters, 1800);
  return chapters;
}

async function getChapterImages(mangaSlug, chapterNumber) {
  const cacheKey = `chapter:${mangaSlug}:${chapterNumber}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // pageListRequest() — pakai RSC headers untuk Next.js
  const response = await axios.get(
    `${BASE_URL}/${mangaSlug}/chapter/${chapterNumber}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `${BASE_URL}/`,
        'rsc': '1', // Next.js RSC header — ini kuncinya!
        'Accept': 'text/x-component, */*',
      },
      timeout: 15000,
    }
  );

  // extractNextJs<ChapterPageDataDto> — parse imageSrc dari RSC payload
  // imageSrc adalah array path gambar relatif
  const imageSrc = extractImageSrcFromRsc(response.data);

  if (!imageSrc || imageSrc.length === 0) {
    throw new Error('Tidak ada gambar ditemukan di chapter ini');
  }

  const images = imageSrc.map((img, i) => ({
    page: i + 1,
    url: `${IMAGE_BASE_URL}/${img.replace(/^\//, '')}`,
  }));

  const result = {
    mangaSlug,
    chapterNumber,
    images,
    totalPages: images.length,
  };

  cacheSet(cacheKey, result, 1800);
  return result;
}

// ─── RSC Parser ──────────────────────────────────────────────────

function extractImageSrcFromRsc(rscData) {
  // Next.js RSC payload adalah stream teks, bukan JSON murni
  // Cari array imageSrc di dalamnya
  try {
    const text = typeof rscData === 'string' ? rscData : JSON.stringify(rscData);

    // Cari pattern "imageSrc":["path1","path2",...]
    const match = text.match(/"imageSrc"\s*:\s*(\[[\s\S]*?\])/);
    if (match) {
      return JSON.parse(match[1]);
    }

    // Fallback: cari semua path gambar yang relevan
    const imgMatches = [...text.matchAll(/"(\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/gi)];
    if (imgMatches.length > 0) {
      return imgMatches.map(m => m[1]);
    }
  } catch (e) {
    console.error('RSC parse error:', e.message);
  }
  return [];
}

// ─── Helper ──────────────────────────────────────────────────────

function formatChapterNumber(raw) {
  const normalized = raw.replace(',', '.');
  const num = parseFloat(normalized);
  if (isNaN(num)) return raw;
  return num === Math.floor(num) ? Math.floor(num).toString() : num.toString();
}

// ─── Rate Limiting ───────────────────────────────────────────────

const rateLimitMap = new Map();
function checkRateLimit(ip, limit = 20, windowSec = 60) {
  const now = Date.now();
  const key = `rate:${ip}`;
  let reqs = (rateLimitMap.get(key) || []).filter(t => now - t < windowSec * 1000);
  if (reqs.length >= limit) return false;
  reqs.push(now);
  rateLimitMap.set(key, reqs);
  return true;
}

// ─── Handler ─────────────────────────────────────────────────────

export default async function handler(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '127.0.0.1';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Max 20/menit.' });
  }

  const { action, query, page, mangaId, chapterId } = req.query;

  try {
    let result;
    switch (action) {
      case 'search':
        result = await searchManga(query, parseInt(page) || 1);
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
      default:
        return res.status(400).json({ error: 'Action tidak valid' });
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error(`[scrape:${action}]`, error.message);

    // Retry dengan session baru jika 401
    if (error.response?.status === 401) {
      sessionCache = null;
      return res.status(401).json({ error: 'Session expired, coba lagi' });
    }

    const msg =
      error.response?.status === 403 ? 'Akses diblokir oleh situs' :
      error.response?.status === 404 ? 'Konten tidak ditemukan' :
      error.code === 'ENOTFOUND' ? 'Tidak bisa terhubung ke server' :
      error.message;

    return res.status(error.response?.status || 500).json({ error: msg });
  }
}