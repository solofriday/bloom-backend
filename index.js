// index.js
import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Create MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '25060'),
  ssl: {
    rejectUnauthorized: true
  }
});

// Test endpoint
app.get('/', async (req, res) => {
  try {
    const [result] = await pool.query('SELECT 1');
    res.json({ message: 'Database connected successfully', test: result });
  } catch (error) {
    res.status(500).json({ message: 'Database connection failed', error: error.message });
  }
});

// Get all plants
app.get('/api/plants', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.*, 
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'status', ps.status,
            'date', ps.date,
            'image_url', ps.image_url
          )
        ) as growth_stages
      FROM plants p
      LEFT JOIN plant_stages ps ON p.id = ps.plant_id
      GROUP BY p.id`
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single plant with its stages
app.get('/api/plants/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.*, 
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'status', ps.status,
            'date', ps.date,
            'image_url', ps.image_url
          )
        ) as growth_stages
      FROM plants p
      LEFT JOIN plant_stages ps ON p.id = ps.plant_id
      WHERE p.id = ?
      GROUP BY p.id`,
      [req.params.id]
    );
    
    if (!rows[0]) {
      return res.status(404).json({ message: 'Plant not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});