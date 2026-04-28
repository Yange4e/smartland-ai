const express = require('express');

const cors = require('cors');

const bodyParser = require('body-parser');

const mysql = require('mysql2/promise');

const path = require('path');

require('dotenv').config();

const fetch = require('node-fetch'); // ✅ ДОБАВИЛ



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



// ── LAND CATEGORIES (ИЗМЕНЕНО) ──

const LAND_CATEGORIES = [

  { id: 1, name_kk: 'Ауылшаруашылығы мақсатындағы жерлер', name_ru: 'Сельскохозяйственные земли', icon: '🌾', color: '#4CAF50' },

  { id: 2, name_kk: 'Елді мекен жерлері', name_ru: 'Земли населённых пунктов', icon: '🏠', color: '#FF6B6B' },

  { id: 3, name_kk: 'Өнеркәсіп, көлік, байланыс, қорғаныс жерлері', name_ru: 'Промышленные земли', icon: '🏭', color: '#757575' },

  { id: 4, name_kk: 'Ерекше қорғалатын табиғи аумақтар', name_ru: 'Природоохранные зоны', icon: '🌿', color: '#2ECC71' },

  { id: 5, name_kk: 'Орман қоры жері', name_ru: 'Лесной фонд', icon: '🌲', color: '#2E7D32' },

  { id: 6, name_kk: 'Су қоры жері', name_ru: 'Водный фонд', icon: '🌊', color: '#1976D2' },

  { id: 7, name_kk: 'Босалқы жер', name_ru: 'Запасные земли', icon: '🏜️', color: '#C2185B' }

];



// ── НОВАЯ ФУНКЦИЯ: реальные населённые пункты ──

async function getNearbyPlaces(lat, lng) {

  try {

    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;

    const res = await fetch(url, {

      headers: {

        'User-Agent': 'SmartLandAI/1.0'

      }

    });

    const data = await res.json();



    const places = [];



    if (data.address) {

      if (data.address.city) {

        places.push({ name: data.address.city, distance: '0' });

      }

      if (data.address.town) {

        places.push({ name: data.address.town, distance: '0' });

      }

      if (data.address.village) {

        places.push({ name: data.address.village, distance: '0' });

      }

      if (data.address.state) {

        places.push({ name: data.address.state, distance: '—' });

      }

    }



    // fallback если ничего нет

    if (places.length === 0) {

      places.push({ name: 'Белгісіз елді мекен', distance: '—' });

    }



    return places.slice(0, 3);

  } catch (err) {

    console.error('Places API error:', err.message);

    return [

      { name: 'Қате', distance: '—' }

    ];

  }

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

      if (statement.trim()) {

        await conn.execute(statement);

      }

    }



    try {

      await conn.execute(

        'INSERT INTO users (username, password, name) VALUES (?, ?, ?)',

        ['admin', require('crypto').createHash('md5').update('password').digest('hex'), 'Админ']

      );

    } catch (e) {}



    try {

      await conn.execute('INSERT INTO layers (id, name, color, description) VALUES (?, ?, ?, ?)', [1, 'Жилые зоны', '#FF6B6B', 'Жилые районы']);

      await conn.execute('INSERT INTO layers (id, name, color, description) VALUES (?, ?, ?, ?)', [2, 'Сельхоз', '#4ECDC4', 'Сельскохозяйственные земли']);

      await conn.execute('INSERT INTO layers (id, name, color, description) VALUES (?, ?, ?, ?)', [3, 'Промышленность', '#95A5A6', 'Промышленные объекты']);

      await conn.execute('INSERT INTO layers (id, name, color, description) VALUES (?, ?, ?, ?)', [4, 'Природа', '#2ECC71', 'Природоохранные зоны']);

    } catch (e) {}



    for (const cat of LAND_CATEGORIES) {

      try {

        await conn.execute(

          'INSERT INTO land_categories (id, name_kk, name_ru, icon, color) VALUES (?, ?, ?, ?, ?)',

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

// ... (весь код без изменений до analyze-area)



app.get('/api/analyze-area', async (req, res) => {

  try {

    const { lat, lng, radius } = req.query;

    

    if (!lat || !lng || !radius) {

      return res.status(400).json({ error: 'lat, lng, radius required' });

    }



    const s = Math.abs(Math.sin(parseFloat(lat) * 1234.5) * Math.cos(parseFloat(lng) * 6789.1));

    

    const breakdown = [

      { id: 2, name_kk: 'Елді мекен жерлері', icon: '🏠', color: '#FF6B6B', percent: Math.round(30 + s * 30) },

      { id: 1, name_kk: 'Ауылшаруашылығы мақсатындағы жерлер', icon: '🌾', color: '#4CAF50', percent: Math.round(20 + s * 20) },

      { id: 3, name_kk: 'Өнеркәсіп жерлері', icon: '🏭', color: '#757575', percent: Math.round(10 + s * 10) },

      { id: 5, name_kk: 'Орман қоры жері', icon: '🌲', color: '#2E7D32', percent: Math.round(10 + s * 10) },

      { id: 6, name_kk: 'Су қоры жері', icon: '🌊', color: '#1976D2', percent: Math.round(5 + s * 5) },

      { id: 7, name_kk: 'Босалқы жер', icon: '🏜️', color: '#C2185B', percent: Math.round(25 - s * 20) }

    ];



    const total = breakdown.reduce((sum, cat) => sum + cat.percent, 0);

    breakdown.forEach(cat => cat.percent = Math.round(cat.percent * 100 / total));



    const dominant = breakdown.reduce((a, b) => a.percent > b.percent ? a : b);



    const places = await getNearbyPlaces(lat, lng); // ✅ ВАЖНО



    res.json({

      success: true,

      dominant,

      breakdown,

      places,

      radius_m: parseInt(radius)

    });

  } catch (err) {

    console.error('Analyze area error:', err);

    res.status(500).json({ success: false, error: err.message });

  }

});



// остальной код БЕЗ ИЗМЕНЕНИЙ
