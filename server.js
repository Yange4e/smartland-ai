const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const path = require('path');
const https = require('https'); // Нақты орындарды іздеу үшін қажет
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
  enableKeepAlive: true,
  keepAliveInitialDelayMs: 0,
});

console.log('🔄 Database config:', {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  database: process.env.DB_NAME || 'geomap'
});

// ── LAND CATEGORIES (Жаңартылған атаулар) ──
const LAND_CATEGORIES = [
  { id: 1, name_kk: '1. Ауылшаруашылығы мақсатындағы жерлер', name_ru: 'Земли сельскохозяйственного назначения', icon: '🌾', color: '#4CAF50' },
  { id: 2, name_kk: '2. Елді мекен жерлері', name_ru: 'Земли населенных пунктов', icon: '🏢', color: '#757575' },
  { id: 3, name_kk: '3. Өнеркәсіп, көлік, байланыс, қорғаныс жерлері', name_ru: 'Земли промышленности, транспорта, связи', icon: '🏭', color: '#8BC34A' },
  { id: 4, name_kk: '4. Ерекше қорғалатын табиғи аумақтар', name_ru: 'Особо охраняемые территории', icon: '🏞️', color: '#2E7D32' },
  { id: 5, name_kk: '5. Орман қоры жері', name_ru: 'Земли лесного фонда', icon: '🌲', color: '#2E7D32' },
  { id: 6, name_kk: '6. Су қоры жері', name_ru: 'Земли водного фонда', icon: '🌊', color: '#1976D2' },
  { id: 7, name_kk: '7. Босалқы жер', name_ru: 'Земли запаса', icon: '🏜️', color: '#C2185B' }
];

// ── КӨМЕКШІ ФУНКЦИЯ: НАҚТЫ ЕЛДІ МЕКЕНДЕРДІ АНЫҚТАУ ──
function getNearbyPlaceName(lat, lng) {
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=kk,ru`;
    
    // Nominatim API User-Agent талап етеді
    const options = {
      headers: { 'User-Agent': 'SmartLandApp/1.0' }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // Ауыл, қала немесе аудан атын алу
          const place = json.address.village || json.address.city || json.address.town || json.address.hamlet || json.address.county || "Белгісіз аймақ";
          resolve(place);
        } catch (e) {
          resolve("Аймақ анықталмады");
        }
      });
    }).on('error', () => resolve("Сервис қолжетімсіз"));
  });
}

// ── INITIALIZE DATABASE ──
async function initDatabase() {
  try {
    const conn = await pool.getConnection();

    const tables = `
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS layers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        color VARCHAR(7) DEFAULT '#00e5a0',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS land_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name_kk VARCHAR(255) NOT NULL,
        name_ru VARCHAR(255),
        icon VARCHAR(10),
        color VARCHAR(7),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS objects (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        layer_id INT,
        land_category_id INT,
        type VARCHAR(50) DEFAULT 'point',
        lat DECIMAL(10, 6) NOT NULL,
        lng DECIMAL(10, 6) NOT NULL,
        area_ha FLOAT,
        area_m2 FLOAT,
        elevation_m INT,
        attributes JSON,
        author_id INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (layer_id) REFERENCES layers(id),
        FOREIGN KEY (land_category_id) REFERENCES land_categories(id),
        FOREIGN KEY (author_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        action VARCHAR(255),
        object_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (object_id) REFERENCES objects(id)
      );
    `;

    const statements = tables.split(';').filter(s => s.trim());
    for (const statement of statements) {
      await conn.execute(statement);
    }

    // Тесттік қолданушы
    try {
      await conn.execute(
        'INSERT INTO users (username, password, name) VALUES (?, ?, ?)',
        ['admin', require('crypto').createHash('md5').update('password').digest('hex'), 'Админ']
      );
    } catch (e) {}

    // Жер санаттарын базаға жаңарту
    for (const cat of LAND_CATEGORIES) {
      try {
        await conn.execute(
          'INSERT INTO land_categories (id, name_kk, name_ru, icon, color) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name_kk=VALUES(name_kk)',
          [cat.id, cat.name_kk, cat.name_ru, cat.icon, cat.color]
        );
      } catch (e) {}
    }

    conn.release();
    console.log('✅ Database initialized successfully');
  } catch (err) {
    console.warn('⚠️ Database init warning:', err.message);
  }
}

// ── API ROUTES ──

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ success: false, error: 'Login and password required' });
    const conn = await pool.getConnection();
    const crypto = require('crypto');
    const hashedPassword = crypto.createHash('md5').update(password).digest('hex');
    const [rows] = await conn.execute('SELECT id, name FROM users WHERE username = ? AND password = ?', [login, hashedPassword]);
    conn.release();
    if (rows.length > 0) res.json({ success: true, user: rows[0] });
    else res.status(401).json({ success: false, error: 'Invalid credentials' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/objects', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute(`
      SELECT o.id, o.name, o.description, o.lat, o.lng, o.type, o.area_ha, o.area_m2, o.elevation_m,
             COALESCE(l.name, 'Без слоя') as layer_name,
             COALESCE(l.color, '#00e5a0') as layer_color,
             COALESCE(lc.name_kk, '') as land_category,
             COALESCE(u.name, 'Unknown') as author_name,
             o.attributes
      FROM objects o
      LEFT JOIN layers l ON o.layer_id = l.id
      LEFT JOIN land_categories lc ON o.land_category_id = lc.id
      LEFT JOIN users u ON o.author_id = u.id
      LIMIT 100
    `);
    conn.release();
    const features = rows.map(row => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [parseFloat(row.lng), parseFloat(row.lat)] },
      properties: { ...row, attributes: row.attributes ? JSON.parse(row.attributes) : {} }
    }));
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analyze-area (Динамикалық елді мекендермен)
app.get('/api/analyze-area', async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    if (!lat || !lng || !radius) return res.status(400).json({ error: 'lat, lng, radius required' });

    // 1. Нақты елді мекен атауын алу
    const placeName = await getNearbyPlaceName(lat, lng);

    const s = Math.abs(Math.sin(parseFloat(lat) * 1234.5) * Math.cos(parseFloat(lng) * 6789.1));
    
    // Жаңартылған санаттар бойынша талдау
    const breakdown = LAND_CATEGORIES.map(cat => ({
      id: cat.id,
      name_kk: cat.name_kk,
      icon: cat.icon,
      color: cat.color,
      percent: Math.round(5 + s * 15) // Рандомды симуляция
    }));

    const total = breakdown.reduce((sum, cat) => sum + cat.percent, 0);
    breakdown.forEach(cat => cat.percent = Math.round(cat.percent * 100 / total));
    const dominant = breakdown.reduce((a, b) => a.percent > b.percent ? a : b);

    res.json({
      success: true,
      dominant,
      breakdown,
      total_objects: Math.round(10 + s * 30),
      population: Math.round(50 + s * 400),
      buildings: Math.round(10 + s * 30),
      places: [
        { name: placeName, distance: "0" }, // Осы жерде нақты атау шығады
        { name: 'Облыс орталығы', distance: (15 + s * 20).toFixed(1) }
      ],
      amenities: { school: 1, hospital: 0, shop: 2, mosque: 1, fuel: 1 },
      radius_m: parseInt(radius)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// БАСҚА БАРЛЫҚ API МАРШРУТТАРЫ (Өзгеріссіз сақталды)
app.get('/api/layers', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT id, name, color, description FROM layers');
    conn.release();
    res.json({ success: true, layers: rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/land-categories', async (req, res) => {
  res.json({ success: true, categories: LAND_CATEGORIES });
});

app.post('/api/objects', async (req, res) => {
  try {
    const { name, description, layer_id, land_category_id, type, lat, lng, attributes } = req.body;
    const conn = await pool.getConnection();
    const [result] = await conn.execute(
      `INSERT INTO objects (name, description, layer_id, land_category_id, type, lat, lng, attributes, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [name, description || '', layer_id || null, land_category_id || null, type || 'point', parseFloat(lat), parseFloat(lng), JSON.stringify(attributes || {})]
    );
    conn.release();
    res.json({ success: true, id: result.insertId });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ SmartLand AI Server running on port ${PORT}`);
  });
}).catch(err => {
  process.exit(1);
});

module.exports = app;
