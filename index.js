const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Create MySQL connection pool with updated SSL config
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '25060'),
  ssl: {
    rejectUnauthorized: false // This is the key change
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

// Rest of your code remains the same...

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});