const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '25060'),
  ssl: {
    rejectUnauthorized: false
  }
});

// Test endpoint
app.get('/', async (req, res) => {
  try {
    const [result] = await pool.query('SELECT 1');
    res.json({ message: 'Database connected successfully', test: result });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ message: 'Database connection failed', error: error.message });
  }
});

// Get all plants with their stages
app.get('/api/plants', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        p.*,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'status', ps.status,
            'date', DATE_FORMAT(ps.date, '%Y-%m-%d'),
            'image', ps.image_url
          )
        ) as growthStages
      FROM plants p
      LEFT JOIN plant_stages ps ON p.id = ps.plant_id
      GROUP BY p.id
    `);
    
    // Parse the JSON string in sensitivities and growthStages
    const plants = rows.map(plant => ({
      ...plant,
      sensitivities: JSON.parse(plant.sensitivities || '[]'),
      growthStages: JSON.parse(plant.growthStages || '[]')
    }));
    
    res.json(plants);
  } catch (error) {
    console.error('Error fetching plants:', error);
    res.status(500).json({ message: 'Error fetching plants', error: error.message });
  }
});

// Get single plant with stages
app.get('/api/plants/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        p.*,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'status', ps.status,
            'date', DATE_FORMAT(ps.date, '%Y-%m-%d'),
            'image', ps.image_url
          )
        ) as growthStages
      FROM plants p
      LEFT JOIN plant_stages ps ON p.id = ps.plant_id
      WHERE p.id = ?
      GROUP BY p.id
    `, [req.params.id]);
    
    if (!rows[0]) {
      return res.status(404).json({ message: 'Plant not found' });
    }
    
    // Parse the JSON strings
    const plant = {
      ...rows[0],
      sensitivities: JSON.parse(rows[0].sensitivities || '[]'),
      growthStages: JSON.parse(rows[0].growthStages || '[]')
    };
    
    res.json(plant);
  } catch (error) {
    console.error('Error fetching plant:', error);
    res.status(500).json({ message: 'Error fetching plant', error: error.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});