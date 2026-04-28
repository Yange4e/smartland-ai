const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const path = require('path');
const https = require('https'); // Нақты елді мекендерді іздеу үшін керек
require('dotenv').config();

const app = express();

// ── MIDDLEWARE ──
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname)));

// ── DATABASE CONNECTION POOL ──
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'geomap',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ── ЖЕР САНАТТАРЫ (ҚР ЖЕР КОДЕКСІНЕ САЙ 7 САНАТ) ──
const LAND_CATEGORIES = [
  { id: 1, name_kk: '1. Ауылшаруашылығы мақсатындағы жерлер', icon: '🌾', color: '#4CAF50' },
  { id: 2, name_kk: '2. Елді мекен жерлері', icon: '🏘️', color: '#FF9800' },
  { id: 3, name_kk: '3. Өнеркәсіп, көлік, байланыс, қорғаныс жерлері', icon: '🏭', color: '#9E9E9E' },
  { id: 4, name_kk: '4. Ерекше қорғалатын табиғи аумақтар', icon: '🏞️', color: '#00BCD4' },
  { id: 5, name_kk: '5. Орман қоры жері', icon: '🌲', color: '#2E7D32' },
  { id: 6, name_kk: '6. Су қоры жері', icon: '💧', color: '#2196F3' },
  { id: 7, name_kk: '7. Босалқы жер', icon: '🏜️', color: '#C2185B' }
];

// ── КӨМЕКШІ ФУНКЦИЯ: НАҚТЫ ЕЛДІ МЕКЕНДЕРДІ ІЗДЕУ (OSM Overpass) ──
function getRealNearbyPlaces(lat, lng) {
  return new Promise((resolve) => {
    // Таңдалған нүктеден 10км радиустағы елді мекендерді іздеу сұранысы
    const overpassQuery = `[out:json][timeout:10];node["place"~"city|town|village"](around:10000,${lat},${lng});out body 5;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const places = json.elements.map(el => ({
            name: el.tags.name || el.tags['name:kk'] || el.tags['name:ru'] || 'Белгісіз елді мекен',
            distance: 'Жақын маңда'
          }));
          resolve(places.length > 0 ? places : [{ name: 'Жақын маңда ірі елді мекендер табылмады', distance: '' }]);
        } catch (e) {
          resolve([{ name: 'Мәлімет алу мүмкін болмады', distance: '' }]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

// ── API ROUTES ──

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// GET /api/analyze-area — Осы жерде елді мекендерді нақты уақытта іздейміз
app.get('/api/analyze-area', async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    
    if (!lat || !lng || !radius) {
      return res.status(400).json({ error: 'lat, lng, radius required' });
    }

    // 1. Нақты елді мекендерді алу (OSM-нен)
    const realPlaces = await getRealNearbyPlaces(lat, lng);

    // 2. Жерді талдау (симуляция)
    const s = Math.abs(Math.sin(parseFloat(lat) * 1234.5) * Math.cos(parseFloat(lng) * 6789.1));
    
    const breakdown = LAND_CATEGORIES.map(cat => {
        let p = 0;
        if (cat.id === 1) p = Math.round(40 + s * 20); // Ауылшаруашылық
        else if (cat.id === 2) p = Math.round(10 + s * 15); // Елді мекен
        else p = Math.round(5 + s * 5); // Қалғандары
        return { ...cat, percent: p };
    });

    // Проценттерді нормализациялау (барлығы 100% болуы үшін)
    const total = breakdown.reduce((sum, c) => sum + c.percent, 0);
    breakdown.forEach(c => c.percent = Math.round(c.percent * 100 / total));

    const dominant = breakdown.reduce((a, b) => a.percent > b.percent ? a : b);

    res.json({
      success: true,
      dominant,
      breakdown,
      population: Math.round(50 + s * 400),
      buildings: Math.round(10 + s * 30),
      places: realPlaces, // Енді мұнда нақты қала/ауыл аттары барады
      amenities: {
        school: Math.round(1 + s * 2),
        hospital: Math.round(0 + s * 1),
        shop: Math.round(2 + s * 3)
      },
      radius_m: parseInt(radius)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Қалған маршруттарды (login, objects т.б.) өзгертпестен төменге қоса беріңіз...
// (Кодтың қалған бөлігі өзгеріссіз қалады)

app.get('/api/land-categories', async (req, res) => {
    res.json({ success: true, categories: LAND_CATEGORIES });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SmartLand AI Server running on port ${PORT}`);
});
