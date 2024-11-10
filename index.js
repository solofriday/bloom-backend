const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mysql = require('mysql2/promise');
const ExifReader = require('exif-reader');

// Initialize express
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MySQL connection pool with optimized settings
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '25060'),
  ssl: { rejectUnauthorized: false },
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// S3 client with optimized settings
const s3Client = new S3Client({
  endpoint: "https://nyc3.digitaloceanspaces.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  },
  forcePathStyle: false,
  maxAttempts: 3
});

// Multer setup with optimized file size
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1 // Only allow 1 file per request
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload an image.'), false);
    }
  },
});

// Helper function to get image date from EXIF
async function getImageDate(buffer) {
  try {
    const exifData = ExifReader.load(buffer);
    if (exifData?.DateTimeOriginal?.description) {
      return new Date(exifData.DateTimeOriginal.description.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
    }
    console.log('No DateTimeOriginal in EXIF data, using current date/time');
    return new Date();
  } catch (err) {
    console.log('Error reading EXIF data:', err.message);
    return new Date();
  }
}

// Optimized plants endpoint using stored procedure
app.get('/api/plants', async (req, res) => {
  try {
    const [results] = await pool.execute('CALL GetPlantsWithStages()');
    const plantsWithStages = results[0].map(plant => {
      let stages = [];
      let sensitivities = [];
      
      try {
        // Check if stages is a string before parsing
        stages = typeof plant.stages === 'string' 
          ? JSON.parse(plant.stages) 
          : (plant.stages || []);
        
        // Check if sensitivities is a string before parsing
        sensitivities = typeof plant.sensitivities === 'string' 
          ? JSON.parse(plant.sensitivities) 
          : (plant.sensitivities || []);
      } catch (parseError) {
        console.error('JSON parsing error:', parseError);
      }

      return {
        ...plant,
        sensitivities,
        growthStages: stages.filter(stage => stage && stage.id !== null)
      };
    });

    console.log('Sending plants data:', {
      count: plantsWithStages.length,
      firstPlant: plantsWithStages[0]
    });

    res.json(plantsWithStages);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      message: 'Error fetching plants', 
      error: error.message 
    });
  }
});

// Optimized upload endpoint
app.post('/api/plant-stages/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.body.status || !req.body.plantId) {
      return res.status(400).json({ 
        message: 'Missing required fields', 
        received: { 
          file: !!req.file, 
          ...req.body 
        } 
      });
    }

    // Verify plant exists
    const [plants] = await pool.execute(
      'SELECT id FROM plants WHERE id = ?',
      [req.body.plantId]
    );

    if (!plants.length) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    // Upload to S3
    const fileKey = `plants/${req.body.plantId}/${uuidv4()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read',
    }));

    const imageUrl = `https://${process.env.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${fileKey}`;
    const dateTaken = await getImageDate(req.file.buffer);

    // Insert new stage and get updated plant data in a transaction
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.execute(
        'INSERT INTO plant_stages (plant_id, status, date_taken, image_url) VALUES (?, ?, ?, ?)',
        [req.body.plantId, req.body.status, dateTaken, imageUrl]
      );

      const [updatedPlant] = await connection.execute(`
        SELECT p.*, 
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', ps.id,
              'status', ps.status,
              'date', DATE_FORMAT(ps.date_taken, '%Y-%m-%d'),
              'image', ps.image_url
            )
            ORDER BY ps.date_taken DESC
          ) as stages
        FROM plants p
        LEFT JOIN plant_stages ps ON p.id = ps.plant_id
        WHERE p.id = ?
        GROUP BY p.id
      `, [req.body.plantId]);

      await connection.commit();

      const plant = {
        ...updatedPlant[0],
        sensitivities: JSON.parse(updatedPlant[0].sensitivities || '[]'),
        growthStages: JSON.parse(updatedPlant[0].stages || '[]').filter(stage => stage.id !== null)
      };

      res.json({ message: 'Stage added successfully', imageUrl, stageId: result.insertId, plant });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Error uploading image', error: error.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));