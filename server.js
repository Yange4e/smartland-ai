const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const mysql      = require('mysql2/promise');
const https      = require('https');
const path       = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname))); // отдаёт index.html

// ── DB POOL ──
const pool = mysql.createPool({
  host     : process.env.MYSQLHOST     || 'localhost',
  port     : process.env.MYSQLPORT     || 3306,
  user     : process.env.MYSQLUSER     || 'root',
  password : process.env.MYSQLPASSWORD || '',
  database : process.env.MYSQLDATABASE || 'geomap',
  waitForConnections : true,
  connectionLimit    : 10,
  queueLimit         : 0,
});

// ── HELPER: HTTP GET ──
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 6000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end',  ()  => resolve(data));
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── HELPER: HTTP POST (для Overpass) ──
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const postData = 'data=' + encodeURIComponent(body);
    const urlObj   = new URL(url);
    const options  = {
      hostname : urlObj.hostname,
      path     : urlObj.pathname,
      method   : 'POST',
      timeout  : 10000,
      headers  : {
        'Content-Type'   : 'application/x-www-form-urlencoded',
        'Content-Length' : Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end',  ()  => resolve(data));
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

// ── 7 САНАТ (Казахстан жер кодексі) ──
const LAND_CATS = {
  1: { name_kk: 'Ауылшаруашылық жері',     icon: '🌾', color: '#4CAF50',
       tags: ['farmland','orchard','vineyard','allotments','greenhouse_horticulture','plant_nursery','meadow'] },
  2: { name_kk: 'Жайылым жері',             icon: '🐄', color: '#8BC34A',
       tags: ['grass','grassland','heath','scrub','fell'] },
  3: { name_kk: 'Елді мекен жері',          icon: '🏘️', color: '#FF9800',
       tags: ['residential','commercial','retail','construction','garages'] },
  4: { name_kk: 'Өнеркәсіп жері',           icon: '🏭', color: '#9E9E9E',
       tags: ['industrial','quarry','landfill','railway','aeroway','port'] },
  5: { name_kk: 'Орман қоры жері',          icon: '🌲', color: '#2E7D32',
       tags: ['forest','wood','tree_row'] },
  6: { name_kk: 'Су қоры жері',             icon: '💧', color: '#2196F3',
       tags: ['water','wetland','reservoir','basin','salt_pond'] },
  7: { name_kk: 'Ерекше қорғалатын аумақ', icon: '🏞️', color: '#00BCD4',
       tags: ['nature_reserve','national_park','protected_area','cemetery'] },
};

// ═══════════════════════════════════════════════════════════
//  МАРШРУТТАР
// ═══════════════════════════════════════════════════════════

// ── LOGIN ──
app.post('/api/login', async (req, res) => {
  const { login, password } = req.body;
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute(
      'SELECT id, name FROM users WHERE username = ? AND password = MD5(?)',
      [login, password]
    );
    conn.release();
    if (rows.length > 0) res.json({ success: true, user: rows[0] });
    else                  res.json({ success: false, error: 'Логин немесе құпиясөз қате' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET ALL OBJECTS (GeoJSON) ──
app.get('/api/objects', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute(`
      SELECT o.id, o.name, o.description, o.lat, o.lng, o.type, o.area_ha, o.area_m2,
             COALESCE(l.name, 'Қабатсыз')  AS layer_name,
             COALESCE(l.color, '#00e5a0')  AS layer_color,
             COALESCE(u.name, 'Белгісіз')  AS author_name,
             o.attributes
      FROM objects o
      LEFT JOIN layers l ON o.layer_id = l.id
      LEFT JOIN users  u ON o.author_id = u.id
    `);
    conn.release();

    const features = rows.map(row => ({
      type     : 'Feature',
      geometry : { type: 'Point', coordinates: [parseFloat(row.lng), parseFloat(row.lat)] },
      properties: { ...row, attributes: JSON.parse(row.attributes || '{}') },
    }));
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET OBJECT BY CLICK (lat, lng) ──
app.get('/api/object', async (req, res) => {
  const lat    = parseFloat(req.query.lat || 0);
  const lng    = parseFloat(req.query.lng || 0);
  const radius = 0.012; // ~1.2 км в градусах

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute(`
      SELECT o.*, l.name AS layer_name, l.color AS layer_color, u.name AS author_name,
             SQRT(POW(o.lat - ?, 2) + POW(o.lng - ?, 2)) AS dist
      FROM objects o
      LEFT JOIN layers l ON o.layer_id = l.id
      LEFT JOIN users  u ON o.author_id = u.id
      WHERE ABS(o.lat - ?) < ? AND ABS(o.lng - ?) < ?
      ORDER BY dist ASC
      LIMIT 1
    `, [lat, lng, lat, radius, lng, radius]);
    conn.release();

    if (rows.length > 0) {
      const obj = rows[0];
      if (obj.attributes) obj.attributes = JSON.parse(obj.attributes);
      if (obj.area_m2)    obj.area_ha    = +(obj.area_m2 / 10000).toFixed(4);
      res.json({ success: true, object: obj });
    } else {
      res.json({ success: true, object: null, location: { lat, lng } });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET LAYERS ──
app.get('/api/layers', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute(
      'SELECT id, name, color, description FROM layers ORDER BY sort_order'
    );
    conn.release();
    res.json({ success: true, layers: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ADD OBJECT ──
app.post('/api/objects', async (req, res) => {
  const { name, description, layer_id, type, lat, lng, attributes } = req.body;
  try {
    const conn = await pool.getConnection();
    const [result] = await conn.execute(
      `INSERT INTO objects
         (name, description, layer_id, type, lat, lng, attributes, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [name, description, layer_id || null, type, lat, lng, JSON.stringify(attributes || {})]
    );
    conn.release();
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ANALYZE AREA — OSM + 7 санат ──
app.get('/api/analyze', async (req, res) => {
  const lat    = parseFloat(req.query.lat    || 0);
  const lng    = parseFloat(req.query.lng    || 0);
  const radius = Math.min(parseInt(req.query.radius || 600), 5000);

  // Overpass query
  const q = `[out:json][timeout:10];(
    way["landuse"](around:${radius},${lat},${lng});
    way["natural"](around:${radius},${lat},${lng});
    node["place"](around:${radius},${lat},${lng});
    node["amenity"](around:${radius},${lat},${lng});
    way["building"](around:${radius},${lat},${lng});
  );out body;`;

  let elements = [];
  try {
    const raw  = await httpPost('https://overpass-api.de/api/interpreter', q);
    elements   = JSON.parse(raw).elements || [];
  } catch (_) { /* нет интернета или таймаут — продолжаем с пустым */ }

  // Считаем landuse теги
  const luCount    = {};
  const places     = [];
  const amenities  = [];
  let   buildings  = 0;
  let   population = 0;

  for (const el of elements) {
    const tags = el.tags || {};
    if (tags.population)          population += parseInt(tags.population.replace(/\D/g,'')) || 0;
    if (tags.place)               places.push({ name: tags.name || tags['name:kk'] || '—', type: tags.place, pop: parseInt(tags.population || 0) });
    if (tags.amenity)             amenities.push(tags.amenity);
    if (el.type === 'way' && tags.building) buildings++;
    const lu = tags.landuse || tags.natural || tags.leisure;
    if (lu) luCount[lu] = (luCount[lu] || 0) + 1;
  }

  // Скорим 7 санат
  const scores = {};
  for (const [id, cat] of Object.entries(LAND_CATS)) {
    let s = cat.tags.reduce((acc, t) => acc + (luCount[t] || 0) * 10, 0);
    if (+id === 3) s += amenities.length * 2 + buildings;
    if (s > 0) scores[id] = s;
  }

  // Если OSM дал 0 — фолбэк по координатам
  if (Object.keys(scores).length === 0) {
    const seed = Math.abs(Math.sin(lat * 1234.5) * Math.cos(lng * 6789.1));
    scores[1] = Math.max(5, Math.round(seed * 60));
    scores[2] = Math.max(3, Math.round((1 - seed) * 30));
  }

  // Сортируем и считаем проценты
  const total     = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const breakdown = Object.entries(scores)
    .sort(([,a],[,b]) => b - a)
    .map(([id, score]) => {
      const cat = LAND_CATS[id];
      return { id: +id, name_kk: cat.name_kk, icon: cat.icon, color: cat.color,
               score, percent: Math.round(score / total * 100) };
    });

  const dominant = breakdown[0] || { name_kk: 'Ауылшаруашылық жері', icon: '🌾', color: '#4CAF50', percent: 100 };

  // Считаем amenity counts
  const amenCounts = {};
  for (const a of amenities) amenCounts[a] = (amenCounts[a] || 0) + 1;
  const topAmen = Object.entries(amenCounts).sort(([,a],[,b])=>b-a).slice(0,8)
    .reduce((o,[k,v]) => ({ ...o, [k]: v }), {});

  res.json({
    success    : true,
    dominant,
    breakdown,
    land_use_raw: luCount,
    population,
    places     : places.slice(0, 5),
    amenities  : topAmen,
    buildings,
    radius_m   : radius,
    total_elements: elements.length,
  });
});

// ── ELEVATION ──
app.get('/api/elevation', async (req, res) => {
  const lat = parseFloat(req.query.lat || 0);
  const lng = parseFloat(req.query.lng || 0);
  try {
    const raw  = await httpGet(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`);
    const data = JSON.parse(raw);
    res.json({ success: true, elevation: data.results?.[0]?.elevation ?? null });
  } catch (_) {
    res.json({ success: false, elevation: null });
  }
});

// ── TEST ──
app.get('/api/test', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [tables] = await conn.execute('SHOW TABLES');
    conn.release();
    res.json({ status: 'OK ✅', tables: tables.map(r => Object.values(r)[0]) });
  } catch (err) {
    res.status(500).json({ status: 'DB Error ❌', error: err.message });
  }
});

// ── START ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SmartLand AI сервері қосылды: http://localhost:${PORT}`));
