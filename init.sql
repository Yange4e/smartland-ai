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

CREATE TABLE IF NOT EXISTS objects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  layer_id INT,
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

-- Test data
INSERT INTO users (username, password, name) 
VALUES ('admin', MD5('password'), 'Admin User')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO layers (id, name, color, description) 
VALUES 
  (1, 'Жилые зоны', '#FF6B6B', 'Жилые районы'),
  (2, 'Сельхоз', '#4ECDC4', 'Сельскохозяйственные земли'),
  (3, 'Промышленность', '#95A5A6', 'Промышленные объекты'),
  (4, 'Природа', '#2ECC71', 'Природоохранные зоны')
ON DUPLICATE KEY UPDATE id=id;