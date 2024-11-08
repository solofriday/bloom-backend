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
    // First get the plants
    const [plants] = await pool.execute(`
      SELECT id, name, location, sensitivities
      FROM plants
    `);

    // Then get stages for each plant
    const plantsWithStages = await Promise.all(plants.map(async (plant) => {
      const [stages] = await pool.execute(`
        SELECT status, date, image_url as image
        FROM plant_stages
        WHERE plant_id = ?
        ORDER BY date
      `, [plant.id]);

      return {
        ...plant,
        sensitivities: plant.sensitivities ? JSON.parse(plant.sensitivities) : [],
        growthStages: stages.map(stage => ({
          ...stage,
          date: stage.date.toISOString().split('T')[0]
        }))
      };
    }));

    res.json(plantsWithStages);
  } catch (error) {
    console.error('Error fetching plants:', error);
    res.status(500).json({ message: 'Error fetching plants', error: error.message });
  }
});

// Get single plant with stages
app.get('/api/plants/:id', async (req, res) => {
  try {
    // Get plant details
    const [plants] = await pool.execute(`
      SELECT id, name, location, sensitivities
      FROM plants
      WHERE id = ?
    `, [req.params.id]);

    if (!plants[0]) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    // Get plant stages
    const [stages] = await pool.execute(`
      SELECT status, date, image_url as image
      FROM plant_stages
      WHERE plant_id = ?
      ORDER BY date
    `, [req.params.id]);

    const plant = {
      ...plants[0],
      sensitivities: plants[0].sensitivities ? JSON.parse(plants[0].sensitivities) : [],
      growthStages: stages.map(stage => ({
        ...stage,
        date: stage.date.toISOString().split('T')[0]
      }))
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