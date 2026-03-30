# Softkomik Scraper + Reader (All-in-One untuk Vercel)

Scraper komik Softkomik lengkap dengan reader HTML, siap deploy ke Vercel dalam satu project.

## 📁 Struktur Project

```
softkomik-scraper/
├── api/
│   ├── scrape.js      ← API endpoint untuk scraping
│   └── image.js       ← Proxy image
├── public/
│   └── index.html     ← Reader UI (diakses dari root /)
├── package.json
├── vercel.json        ← Config routing untuk Vercel
└── .gitignore
```

## 🚀 Quick Start

### 1. Setup Lokal

```bash
# Extract zip ini
unzip softkomik-scraper.zip
cd softkomik-scraper

# Install dependencies
npm install

# Test lokal
npm run dev

# Akan running di:
# - Reader: http://localhost:3000
# - API: http://localhost:3000/api/scrape
```

### 2. Deploy ke Vercel

```bash
# Install Vercel CLI (first time only)
npm i -g vercel

# Login ke Vercel
vercel login

# Deploy (dari folder project)
vercel deploy --prod

# Selesai! Akses di: https://[project-name].vercel.app
```

## 📡 API Endpoints

Semua endpoint otomatis same-origin (tidak perlu CORS config khusus).

### Search
```
GET /api/scrape?action=search&query=bleach
```

### Manga Details
```
GET /api/scrape?action=manga&query=manga-id
```

### List Chapters
```
GET /api/scrape?action=chapters&query=manga-id
```

### Chapter Images
```
GET /api/scrape?action=chapter&mangaId=manga-id&chapterId=chapter-id
```

### Image Proxy
```
GET /api/image?url=https://image.softkomik.com/...
```

## ⚙️ Troubleshooting

### Images tidak muncul?
- Periksa Network tab di DevTools
- Gunakan `/api/image?url=...` untuk proxy image

### CSS selectors berubah?
- Inspect element di softkomik.co
- Update selectors di `api/scrape.js` (cari `.item-manga`, `.chapter-item`, etc)

### Rate limited?
- Default: 10 requests per minute per IP
- Edit di `api/scrape.js` fungsi `checkRateLimit()`

### Deploy failed?
- Cek Vercel dashboard logs
- Pastikan `package.json` ada (sudah termasuk)
- Node 18.x compatible

## 🎯 Development Tips

### Test API lokal:
```bash
npm run dev

# Di terminal lain:
curl "http://localhost:3000/api/scrape?action=search&query=bleach"
```

### Modifikasi Reader:
- Edit `public/index.html` langsung
- Refresh browser untuk melihat perubahan

### Fix CSS Selectors:
1. Buka softkomik.co di browser
2. Open DevTools (F12)
3. Inspect element untuk find class/id
4. Update di `api/scrape.js`

Contoh:
```javascript
// Before (mungkin sudah tidak valid)
$(selector).find('.title')

// After (update sesuai HTML terbaru)
$(selector).find('.manga-title')
```

## 📝 Common Issues

**Q: API error "Content not found"**
A: CSS selectors mungkin berubah. Update di `api/scrape.js`

**Q: Images broken di reader**
A: Gunakan `/api/image?url=...` untuk proxy

**Q: Deploy terlalu lama**
A: Vercel punya timeout 30 detik. Buat fallback jika API lambat.

## 🔗 Links

- [Vercel Docs](https://vercel.com/docs)
- [Cheerio Docs](https://cheerio.js.org)
- [Axios Docs](https://axios-http.com)

## ⚖️ Legal

Softkomik adalah situs legal Indonesia. Pastikan scraping dilakukan secara:
- Respectful (jangan spam)
- Set User-Agent yang proper
- Respect `robots.txt` jika ada
- Tidak overload server

Happy scraping! 🎉
