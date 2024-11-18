// Updated bloom-backend index.js

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

// Updated API endpoint to get plants with stages and locations
app.get('/api/plants', async (req, res) => {
  const userId = req.query.userId || null;
  const status = req.query.status || null;

  try {
    console.log('Fetching plants with stages, locations, and photos...');
    const [results] = await pool.execute('CALL GetPlantsWithStagesAndLocations(?, ?)', [userId, status]);
    
    const plants = results[0].map(plant => {
      try {
        // Parse JSON strings only if they're not already objects
        const variety = typeof plant.variety === 'string' ? JSON.parse(plant.variety) : plant.variety;
        const stage = typeof plant.stage === 'string' ? JSON.parse(plant.stage) : plant.stage;
        const location = typeof plant.location === 'string' ? JSON.parse(plant.location) : plant.location;
        const photos = typeof plant.photos === 'string' ? JSON.parse(plant.photos) : (plant.photos || []);
        const notes = typeof plant.notes === 'string' ? JSON.parse(plant.notes) : (plant.notes || []);
        const warning = typeof plant.warning === 'string' ? JSON.parse(plant.warning) : (plant.warning || {
          cold_tolerance: null,
          heat_tolerance: null
        });

        return {
          plant_obj_id: plant.plant_obj_id,
          user_id: plant.user_id,
          plant_name: plant.plant_name,
          variety,
          stage,
          location,
          photos,
          notes,
          warning,
          date_updated: plant.date_updated,
          date_planted: plant.date_planted,
          is_transplant: plant.is_transplant,
          status: plant.status,
          current_temp: plant.current_temp
        };
      } catch (parseError) {
        console.error('Error parsing plant data:', parseError, {
          plantId: plant.plant_obj_id,
          rawData: plant
        });
        return {
          plant_obj_id: plant.plant_obj_id,
          user_id: plant.user_id,
          plant_name: plant.plant_name,
          variety: {},
          stage: {},
          location: {},
          photos: [],
          notes: [],
          warning: {
            cold_tolerance: null,
            heat_tolerance: null
          },
          date_updated: plant.date_updated,
          date_planted: plant.date_planted,
          is_transplant: plant.is_transplant,
          status: plant.status,
          current_temp: plant.current_temp,
        };
      }
    });

    console.log('Sending structured plants data:', plants);
    res.json(plants);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      message: 'Error fetching plants', 
      error: error.message 
    });
  }
});

// Upload endpoint for plant stages
app.post('/api/plant-stages/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.body.status || !req.body.plantId) {
      return res.status(400).json({ 
        message: 'Missing required fields'
      });
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

    // Insert into database
    const [result] = await pool.execute(
      'INSERT INTO photo (storage_photo_id, plant_obj_id, date_taken, date_uploaded) VALUES (?, ?, ?, ?)',
      [fileKey, req.body.plantId, dateTaken, new Date()]
    );

    res.json({
      success: true,
      photoId: result.insertId,
      imageUrl
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      message: 'Error uploading image', 
      error: error.message
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
