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

// Update the plants endpoint
app.get('/api/plants', async (req, res) => {
  try {
    const [results] = await pool.execute('CALL GetPlantsWithStages()');
    
    // SP returns results as first element of array
    const plants = results[0].map(plant => {
      try {
        console.log('Processing plant:', {
          id: plant.id,
          rawStages: plant.stages,
          rawSensitivities: plant.sensitivities
        });

        const stages = plant.stages ? JSON.parse(plant.stages) : [];
        const sensitivities = plant.sensitivities ? JSON.parse(plant.sensitivities) : [];

        return {
          ...plant,
          sensitivities,
          growthStages: stages.filter(stage => stage && stage.image)
        };
      } catch (parseError) {
        console.error('Error parsing plant data:', parseError, {
          plantId: plant.id,
          stages: plant.stages,
          sensitivities: plant.sensitivities
        });
        return {
          ...plant,
          sensitivities: [],
          growthStages: []
        };
      }
    });

    console.log('Processed plants:', plants.map(p => ({
      id: p.id,
      name: p.name,
      stagesCount: p.growthStages.length,
      sampleStage: p.growthStages[0]
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

// Update the upload endpoint with better error handling
app.post('/api/plant-stages/upload', upload.single('image'), async (req, res) => {
  try {
    console.log('Upload request received:', {
      file: req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      } : null,
      body: req.body
    });

    if (!req.file || !req.body.status || !req.body.plantId) {
      return res.status(400).json({ 
        message: 'Missing required fields', 
        received: { 
          file: !!req.file, 
          status: req.body.status,
          plantId: req.body.plantId 
        } 
      });
    }

    // Verify plant exists first
    const [plants] = await pool.execute(
      'SELECT id FROM plants WHERE id = ?',
      [req.body.plantId]
    );

    if (!plants.length) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    try {
      // Upload to S3
      const fileKey = `plants/${req.body.plantId}/${uuidv4()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
      console.log('Uploading to S3:', {
        bucket: process.env.DO_SPACES_BUCKET,
        key: fileKey,
        contentType: req.file.mimetype
      });

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ACL: 'public-read',
      }));

      const imageUrl = `https://${process.env.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${fileKey}`;
      console.log('File uploaded, URL:', imageUrl);

      // Get date from EXIF or use current date
      const dateTaken = await getImageDate(req.file.buffer);
      console.log('Using date:', dateTaken);

      // Insert into database
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        console.log('Starting database transaction');

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
            ) as stages
          FROM plants p
          LEFT JOIN plant_stages ps ON p.id = ps.plant_id
          WHERE p.id = ?
          GROUP BY p.id
        `, [req.body.plantId]);

        await connection.commit();
        console.log('Database transaction committed');

        const plant = {
          ...updatedPlant[0],
          sensitivities: JSON.parse(updatedPlant[0].sensitivities || '[]'),
          growthStages: JSON.parse(updatedPlant[0].stages || '[]')
        };

        res.json({
          message: 'Stage added successfully',
          imageUrl,
          stageId: result.insertId,
          plant
        });

      } catch (dbError) {
        await connection.rollback();
        console.error('Database error:', dbError);
        throw new Error(`Database error: ${dbError.message}`);
      } finally {
        connection.release();
      }

    } catch (uploadError) {
      console.error('S3 upload error:', uploadError);
      throw new Error(`S3 upload failed: ${uploadError.message}`);
    }

  } catch (error) {
    console.error('Upload error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      message: 'Error uploading image', 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));