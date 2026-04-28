const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const path = require('path');
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

// ── INITIALIZE DATABASE ──
async function initDatabase() {
  try {
    const conn = await pool.getConnection();

    // Create tables
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

    // Execute each statement
    const statements = tables.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await conn.execute(statement);
      }
    }

    // Insert test data
    try {
      await conn.execute(
        'INSERT INTO users (username, password, name) VALUES (?, ?, ?)',
        ['admin', require('crypto').createHash('md5').update('password').digest('hex'), 'Админ']
      );
    } catch (e) {
      // User already exists
    }

    try {
      await conn.execute(
        'INSERT INTO layers (id, name, color, description) VALUES (?, ?, ?, ?)',
        [1, 'Жилые зоны', '#FF6B6B', 'Жилые районы']
      );
      await conn.execute(
        'INSERT INTO layers (id, name, color, description) VALUES (?, ?, ?, ?)',
        [2, 'Сельхоз', '#4ECDC4', 'Сельскохозяйственные земли']
      );
      await conn.execute(
        'INSERT INTO layers (id, name, color, description) VALUES (?, ?, ?, ?)',
        [3, 'Промышленность', '#95A5A6', 'Промышленные объекты']
      );
      await conn.execute(
        'INSERT INTO layers (id, name, color, description) VALUES (?, ?, ?, ?)',
        [4, 'Природа', '#2ECC71', 'Природоохранные зоны']
      );
    } catch (e) {
      // Layers already exist
    }

    // Insert land categories
    for (const cat of LAND_CATEGORIES) {
      try {
        await conn.execute(
          'INSERT INTO land_categories (id, name_kk, name_ru, icon, color) VALUES (?, ?, ?, ?, ?)',
          [cat.id, cat.name_kk, cat.name_ru, cat.icon, cat.color]
        );
      } catch (e) {
        // Already exists
      }
    }

    conn.release();
    console.log('✅ Database initialized successfully');
  } catch (err) {
    console.warn('⚠️ Database init warning:', err.message);
  }
}

// ── API ROUTES ──

// GET / (serve index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ success: false, error: 'Login and password required' });
    }

    const conn = await pool.getConnection();
    const crypto = require('crypto');
    const hashedPassword = crypto.createHash('md5').update(password).digest('hex');

    const [rows] = await conn.execute(
      'SELECT id, name FROM users WHERE username = ? AND password = ?',
      [login, hashedPassword]
    );
    conn.release();

    if (rows.length > 0) {
      res.json({ success: true, user: rows[0] });
    } else {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/me
app.get('/api/me', async (req, res) => {
  try {
    res.json({ logged_in: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/objects (GeoJSON)
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
      geometry: {
        type: 'Point',
        coordinates: [parseFloat(row.lng), parseFloat(row.lat)]
      },
      properties: {
        ...row,
        attributes: row.attributes ? JSON.parse(row.attributes) : {}
      }
    }));

    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    console.error('Get objects error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/object (single object by coordinates)
app.get('/api/object', async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, error: 'lat and lng required' });
    }

    const conn = await pool.getConnection();

    const [rows] = await conn.execute(`
      SELECT o.id, o.name, o.description, o.lat, o.lng, o.type, o.area_ha, o.area_m2, o.elevation_m,
             COALESCE(l.name, 'Без слоя') as layer_name,
             COALESCE(l.color, '#00e5a0') as layer_color,
             COALESCE(lc.name_kk, '') as land_category,
             COALESCE(u.name, 'Unknown') as author_name,
             o.attributes,
             (6371 * acos(cos(radians(?)) * cos(radians(o.lat)) * cos(radians(o.lng) - radians(?)) + sin(radians(?)) * sin(radians(o.lat)))) as distance
      FROM objects o
      LEFT JOIN layers l ON o.layer_id = l.id
      LEFT JOIN land_categories lc ON o.land_category_id = lc.id
      LEFT JOIN users u ON o.author_id = u.id
      HAVING distance < 0.1
      ORDER BY distance LIMIT 1
    `, [lat, lng, lat]);

    conn.release();

    if (rows.length > 0) {
      const obj = rows[0];
      obj.attributes = obj.attributes ? JSON.parse(obj.attributes) : {};
      res.json({ success: true, object: obj });
    } else {
      res.json({ success: false, object: null });
    }
  } catch (err) {
    console.error('Get object error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/elevation
app.get('/api/elevation', (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng required' });
    }

    const elevation = 100 + Math.abs(Math.sin(lat * 1000) * Math.cos(lng * 1000)) * 500;
    res.json({ elevation: Math.round(elevation) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analyze-area
app.get('/api/analyze-area', async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    
    if (!lat || !lng || !radius) {
      return res.status(400).json({ error: 'lat, lng, radius required' });
    }

    // Mock area analysis with realistic land category distribution
    const s = Math.abs(Math.sin(parseFloat(lat) * 1234.5) * Math.cos(parseFloat(lng) * 6789.1));
    
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

    // Normalize percentages
    const total = breakdown.reduce((sum, cat) => sum + cat.percent, 0);
    breakdown.forEach(cat => cat.percent = Math.round(cat.percent * 100 / total));

    const dominant = breakdown.reduce((a, b) => a.percent > b.percent ? a : b);

    const population = Math.round(50 + s * 400);
    const buildings = Math.round(10 + s * 30);

    res.json({
      success: true,
      dominant,
      breakdown,
      total_objects: buildings,
      population,
      buildings,
      places: [
        { name: 'Ақмола ауылы', distance: (2 + s * 3).toFixed(1) },
        { name: 'Түркістан ауылы', distance: (5 + s * 4).toFixed(1) }
      ],
      amenities: {
        school: Math.round(1 + s * 2),
        hospital: Math.round(0 + s * 1),
        shop: Math.round(2 + s * 3),
        mosque: Math.round(0 + s * 1),
        fuel: Math.round(1 + s * 1)
      },
      radius_m: parseInt(radius)
    });
  } catch (err) {
    console.error('Analyze area error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/layers
app.get('/api/layers', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT id, name, color, description FROM layers');
    conn.release();
    res.json({ success: true, layers: rows });
  } catch (err) {
    console.error('Get layers error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/land-categories
app.get('/api/land-categories', async (req, res) => {
  try {
    res.json({ success: true, categories: LAND_CATEGORIES });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/objects (add new object)
app.post('/api/objects', async (req, res) => {
  try {
    const { name, description, layer_id, land_category_id, type, lat, lng, attributes } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Name required' });
    }

    if (!lat || !lng) {
      return res.status(400).json({ success: false, error: 'Coordinates required' });
    }

    const conn = await pool.getConnection();
    const [result] = await conn.execute(
      `INSERT INTO objects (name, description, layer_id, land_category_id, type, lat, lng, attributes, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [
        name,
        description || '',
        layer_id || null,
        land_category_id || null,
        type || 'point',
        parseFloat(lat),
        parseFloat(lng),
        JSON.stringify(attributes || {})
      ]
    );
    conn.release();

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Add object error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ERROR HANDLING ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── 404 HANDLER ──
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── START SERVER ──
const PORT = process.env.PORT || 3000;

// Initialize database before starting server
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ SmartLand AI Server running on port ${PORT}`);
    console.log(`🌍 Open http://localhost:${PORT}`);
    console.log(`📍 API: http://localhost:${PORT}/api/objects\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// ── GRACEFUL SHUTDOWN ──
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

module.exports = app;
