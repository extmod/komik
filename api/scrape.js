// api/scrape.js - Advanced scraper dengan caching & session management

import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://softkomik.co';

// Simple in-memory cache
const cache = {
  data: new Map(),
  set(key, value, ttl = 3600) {
    this.data.set(key, {
      value,
      expires: Date.now() + ttl * 1000
    });
  },
  get(key) {
    const item = this.data.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.data.delete(key);
      return null;
    }
    return item.value;
  }
};

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': BASE_URL,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
};

const rateLimitMap = new Map();

function checkRateLimit(ip, limit = 10, window = 60) {
  const now = Date.now();
  const key = `rate:${ip}`;
  
  let requests = rateLimitMap.get(key) || [];
  requests = requests.filter(t => now - t < window * 1000);
  
  if (requests.length >= limit) {
    return false;
  }
  
  requests.push(now);
  rateLimitMap.set(key, requests);
  return true;
}

export default async function handler(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ 
      error: 'Too many requests',
      message: 'Max 10 requests per minute'
    });
  }

  const { action, query, mangaId, chapterId } = req.query;

  try {
    let result;
    
    switch(action) {
      case 'search':
        result = await searchManga(query);
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
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    return res.status(200).json(result);
  } catch (error) {
    console.error(`[${action}] Error:`, error.message);
    
    let errorMsg = error.message;
    if (error.code === 'ECONNREFUSED') {
      errorMsg = 'Cannot connect to softkomik.co';
    } else if (error.response?.status === 403) {
      errorMsg = 'Access forbidden - possibly rate limited or blocked';
    } else if (error.response?.status === 404) {
      errorMsg = 'Content not found';
    }
    
    return res.status(error.response?.status || 500).json({ 
      error: errorMsg,
      action,
      timestamp: new Date().toISOString()
    });
  }
}

async function searchManga(query) {
  if (!query || query.length < 2) {
    throw new Error('Query minimal 2 karakter');
  }

  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const endpoints = [
    `${BASE_URL}/?s=${encodeURIComponent(query)}`,
    `${BASE_URL}/search/${encodeURIComponent(query)}/`,
  ];

  let data;
  for (const url of endpoints) {
    try {
      const response = await axios.get(url, { headers, timeout: 10000 });
      data = response.data;
      break;
    } catch (e) {
      continue;
    }
  }

  if (!data) throw new Error('Search endpoint tidak accessible');

  const $ = cheerio.load(data);
  const results = [];
  
  const selectors = [
    '.item-manga',
    '.manga-item',
    '.post-item',
    '[data-type="manga"]',
    '.movie'
  ];

  for (const selector of selectors) {
    $(selector).each((i, el) => {
      const $el = $(el);
      const title = $el.find('.title, h3, .name, .manga-name').text().trim();
      const href = $el.find('a').first().attr('href');
      const cover = $el.find('img').attr('src') || $el.find('img').attr('data-src');
      
      if (title && href) {
        const id = extractIdFromUrl(href);
        if (id && !results.find(r => r.id === id)) {
          results.push({
            title,
            url: href,
            id,
            cover: normalizeImageUrl(cover)
          });
        }
      }
    });
    
    if (results.length > 0) break;
  }

  cache.set(cacheKey, results, 3600);
  return results;
}

async function getMangaDetails(mangaId) {
  const cacheKey = `manga:${mangaId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/manga/${mangaId}/`;
  const { data } = await axios.get(url, { headers, timeout: 10000 });
  const $ = cheerio.load(data);

  const details = {
    id: mangaId,
    title: extractText($, ['.manga-title', '.title', 'h1']),
    cover: normalizeImageUrl(extractImage($, ['.manga-cover', '.cover img'])),
    status: extractText($, ['.status', '[class*="status"]']),
    author: extractText($, ['.author', '[class*="author"]']),
    description: extractText($, ['.description', '.sinopsis', '[class*="sinopsis"]']),
    genres: [],
    rating: extractText($, ['.rating', '.score']),
    totalChapters: 0,
    url
  };

  $('[class*="genre"]').each((i, el) => {
    const genre = $(el).text().trim();
    if (genre) details.genres.push(genre);
  });

  cache.set(cacheKey, details, 3600);
  return details;
}

async function getChapters(mangaId) {
  const cacheKey = `chapters:${mangaId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/manga/${mangaId}/`;
  const { data } = await axios.get(url, { headers, timeout: 10000 });
  const $ = cheerio.load(data);

  const chapters = [];
  
  const chapterSelectors = [
    '.chapter-item',
    '.ch-item',
    '.chapter',
    '[class*="chapter"]'
  ];

  for (const selector of chapterSelectors) {
    $(selector).each((i, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const href = link.attr('href');
      const title = link.text().trim();
      const dateEl = $el.find('[class*="date"], .date, time');
      const date = dateEl.text().trim() || dateEl.attr('datetime');

      if (href && title) {
        const id = extractIdFromUrl(href);
        chapters.push({
          title,
          url: href,
          id,
          date: parseDate(date)
        });
      }
    });

    if (chapters.length > 0) break;
  }

  chapters.sort((a, b) => new Date(a.date) - new Date(b.date));

  cache.set(cacheKey, chapters, 1800);
  return chapters;
}

async function getChapterImages(mangaId, chapterId) {
  const cacheKey = `chapter:${mangaId}:${chapterId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/manga/${mangaId}/${chapterId}/`;
  const { data } = await axios.get(url, { headers, timeout: 15000 });
  const $ = cheerio.load(data);

  const images = [];
  
  const imageSelectors = [
    '.chapter-image img',
    '.page img',
    '[class*="image"] img',
    'img[src*="image"]'
  ];

  for (const selector of imageSelectors) {
    $(selector).each((i, el) => {
      const src = $(el).attr('src') || 
                  $(el).attr('data-src') || 
                  $(el).attr('data-lazy-src');
      
      if (src && !src.includes('ad')) {
        images.push({
          page: i + 1,
          url: normalizeImageUrl(src)
        });
      }
    });

    if (images.length > 0) break;
  }

  const result = {
    mangaId,
    chapterId,
    images,
    totalPages: images.length
  };

  cache.set(cacheKey, result, 1800);
  return result;
}

function extractIdFromUrl(url) {
  if (!url) return null;
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}

function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return BASE_URL + (url.startsWith('/') ? url : '/' + url);
}

function extractText($, selectors) {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) return text;
  }
  return '';
}

function extractImage($, selectors) {
  for (const selector of selectors) {
    const src = $(selector).first().attr('src') || $(selector).first().attr('data-src');
    if (src) return src;
  }
  return null;
}

function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  
  const match = dateStr.match(/(\d+)\s+(jam|hari|minggu|bulan|tahun|second|minute|hour|day|week|month|year)\s+lalu/i);
  if (match) {
    const [, num, unit] = match;
    const date = new Date();
    const subtract = parseInt(num);
    
    if (['hari', 'day'].includes(unit.toLowerCase())) date.setDate(date.getDate() - subtract);
    if (['jam', 'hour'].includes(unit.toLowerCase())) date.setHours(date.getHours() - subtract);
    
    return date.toISOString();
  }
  
  return new Date(dateStr).toISOString();
}
