const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = mysql.createPool({
  host: process.env.MYSQLHOST || 'localhost',
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || '',
  database: process.env.MYSQLDATABASE || 'geomap',
  port: process.env.MYSQLPORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

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
    
    if (rows.length > 0) {
      res.json({ success: true, user: rows[0] });
    } else {
      res.json({ success: false, error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ── REGISTER (Добавление нового аккаунта) ──
app.post('/api/register', async (req, res) => {
  const { login, password, name } = req.body;
  try {
    const conn = await pool.getConnection();
    
    // 1. Проверяем, существует ли уже пользователь с таким логином
    const [existingUsers] = await conn.execute(
      'SELECT id FROM users WHERE username = ?',
      [login]
    );
    
    if (existingUsers.length > 0) {
      conn.release();
      return res.json({ success: false, error: 'Данный логин уже занят' });
    }

    // 2. Вставляем нового пользователя (используем MD5 для совпадения с методом логина)
    const [result] = await conn.execute(
      'INSERT INTO users (username, password, name) VALUES (?, MD5(?), ?)',
      [login, password, name || login]
    );
    conn.release();

    res.json({ success: true, userId: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ── GET ALL OBJECTS ──
app.get('/api/objects', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute(`
      SELECT o.id, o.name, o.description, o.lat, o.lng, o.type, o.area_ha, o.area_m2,
             COALESCE(l.name, 'Без слоя') as layer_name, COALESCE(l.color, '#00e5a0') as layer_color,
             COALESCE(u.name, 'Unknown') as author_name, o.attributes
      FROM objects o
      LEFT JOIN layers l ON o.layer_id = l.id
      LEFT JOIN users u ON o.author_id = u.id
    `);
    conn.release();
    
    const features = rows.map(row => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [parseFloat(row.lng), parseFloat(row.lat)] },
      properties: { ...row, attributes: JSON.parse(row.attributes || '{}') }
    }));
    
    res.json({ type: 'FeatureCollection', features });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET LAYERS ──
app.get('/api/layers', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.execute('SELECT id, name, color, description FROM layers');
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
      'INSERT INTO objects (name, description, layer_id, type, lat, lng, attributes, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())',
      [name, description, layer_id || null, type, lat, lng, JSON.stringify(attributes || {})]
    );
    conn.release();
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
