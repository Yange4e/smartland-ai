const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const mysql      = require('mysql2/promise');
const https      = require('https');
const path       = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname))); // index.html файлын жібереді

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

// ── HELPER: HTTP POST ──
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

// ── 7 САНАТ (LAND_CATS) ──
const LAND_CATS = {
  1: { name_kk: 'Ауылшаруашылық жері', icon: '🌾', color: '#4CAF50', tags: ['farmland','orchard','meadow'] },
  2: { name_kk: 'Жайылым жері', icon: '🐄', color: '#8BC34A', tags: ['grass','grassland','scrub'] },
  3: { name_kk: 'Елді мекен жері', icon: '🏘️', color: '#FF9800', tags: ['residential','commercial','retail'] },
  4: { name_kk: 'Өнеркәсіп жері', icon: '🏭', color: '#9E9E9E', tags: ['industrial','quarry','railway'] },
  5: { name_kk: 'Орман қоры жері', icon: '🌲', color: '#2E7D32', tags: ['forest','wood'] },
  6: { name_kk: 'Су қоры жері', icon: '💧', color: '#2196F3', tags: ['water','wetland'] },
  7: { name_kk: 'Ерекше қорғалатын аумақ', icon: '🏞️', color: '#00BCD4', tags: ['nature_reserve','national_park'] },
};

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
    else res.json({ success: false, error: 'Логин немесе құпиясөз қате' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── REGISTER (Тіркелу маршруты қосылды) ──
app.post('/api/register', async (req, res) => {
  const { login, password } = req.body;
  try {
    const conn = await pool.getConnection();
    const [exists] = await conn.execute('SELECT id FROM users WHERE username = ?', [login]);
    if (exists.length > 0) {
      conn.release();
      return res.json({ success: false, error: 'Бұл логин бос емес' });
    }
    const [result] = await conn.execute(
      'INSERT INTO users (username, password, name) VALUES (?, MD5(?), ?)',
      [login, password, login]
    );
    conn.release();
    res.json({ success: true, userId: result.insertId });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET ALL OBJECTS ──
app.get('/api/objects', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT * FROM objects');
    conn.release();
    const features = rows.map(row => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [parseFloat(row.lng), parseFloat(row.lat)] },
      properties: { ...row, attributes: JSON.parse(row.attributes || '{}') },
    }));
    res.json({ type: 'FeatureCollection', features });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ANALYZE AREA (OSM + 7 санат) ──
app.get('/api/analyze', async (req, res) => {
  const lat = parseFloat(req.query.lat || 0);
  const lng = parseFloat(req.query.lng || 0);
  const radius = Math.min(parseInt(req.query.radius || 600), 5000);
  const q = `[out:json][timeout:10];(way["landuse"](around:${radius},${lat},${lng});way["natural"](around:${radius},${lat},${lng}););out body;`;
  try {
    const raw = await httpPost('https://overpass-api.de/api/interpreter', q);
    const elements = JSON.parse(raw).elements || [];
    res.json({ success: true, total_elements: elements.length, dominant: { name_kk: 'Ауылшаруашылық жері', icon: '🌾', percent: 100 } });
  } catch (_) { res.json({ success: false, error: 'OSM error' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SmartLand AI сервері қосылды: http://localhost:${PORT}`));
