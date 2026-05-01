const express = require('express');
const mqtt = require('mqtt');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.query(`
    CREATE TABLE IF NOT EXISTS sensor_data (
        id INT AUTO_INCREMENT PRIMARY KEY,
        turbidity FLOAT NOT NULL,
        ph FLOAT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.error(err);
});

const mqttClient = mqtt.connect(process.env.MQTT_URL, {
    clientId: 'PenyuGuard_BE_' + Math.random().toString(16).substr(2, 8),
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
});
mqttClient.on('connect', () => {
    mqttClient.subscribe('penyuguard/sensor/data', (err) => {
        if (err) console.error(err);
    });
});

mqttClient.on('message', (topic, message) => {
    if (topic === 'penyuguard/sensor/data') {
        try {
            const data = JSON.parse(message.toString());
            if (data.turbidity !== undefined && data.ph !== undefined) {
                db.query(
                    'INSERT INTO sensor_data (turbidity, ph) VALUES (?, ?)',
                    [data.turbidity, data.ph],
                    (err) => {
                        if (err) console.error(err);
                    }
                );
            }
        } catch (error) {
            console.error(error);
        }
    }
});

app.get('/api/data/realtime', (req, res) => {
    db.query(
        'SELECT * FROM sensor_data ORDER BY created_at DESC LIMIT 1',
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results[0] || {});
        }
    );
});

app.get('/api/history/weekly', (req, res) => {
    db.query(
        'SELECT * FROM sensor_data WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) ORDER BY created_at ASC',
        (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        }
    );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

setInterval(() => {
    db.query(
        'DELETE FROM sensor_data WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 WEEK)',
        (err, result) => {
            if (err) console.error('Failed to clean up old data:', err);
            else if (result.affectedRows > 0) console.log(`Cleaned up ${result.affectedRows} old records.`);
        }
    );
}, 3600000);
