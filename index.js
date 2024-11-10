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

// Update the plants endpoint to use SP
app.get('/api/plants', async (req, res) => {
  try {
    const [results] = await pool.execute('CALL GetPlantsWithStages()');
    
    // SP returns results as first element of array
    const plants = results[0].map(plant => {
      try {
        return {
          ...plant,
          sensitivities: JSON.parse(plant.sensitivities || '[]'),
          growthStages: JSON.parse(plant.stages || '[]')
            .filter(stage => stage !== null)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        };
      } catch (parseError) {
        console.error('Error parsing plant data:', parseError, plant);
        return {
          ...plant,
          sensitivities: [],
          growthStages: []
        };
      }
    });

    console.log('Sending plants:', plants.map(p => ({
      id: p.id,
      stagesCount: p.growthStages.length
    })));

    res.json(plants);
  } catch (error) {
    console.error('Database error:', {
      message: error.message,
      sql: error.sql,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({ 
      message: 'Error fetching plants', 
      error: error.message 
    });
  }
});

// Update the upload endpoint to use SP
app.post('/api/plant-stages/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.body.status || !req.body.plantId) {
      return res.status(400).json({ 
        message: 'Missing required fields', 
        received: { file: !!req.file, ...req.body } 
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

    // Use SP to add stage and get updated plant data
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [results] = await connection.execute(
        'CALL AddPlantStage(?, ?, ?, ?, @stage_id)',
        [req.body.plantId, req.body.status, dateTaken, imageUrl]
      );

      // Get the stage ID
      const [[{ '@stage_id': stageId }]] = await connection.execute('SELECT @stage_id');

      await connection.commit();

      // SP returns updated plant data in first result set
      const plant = {
        ...results[0][0],
        sensitivities: JSON.parse(results[0][0].sensitivities || '[]'),
        growthStages: JSON.parse(results[0][0].stages || '[]')
      };

      res.json({
        message: 'Stage added successfully',
        imageUrl,
        stageId,
        plant
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

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