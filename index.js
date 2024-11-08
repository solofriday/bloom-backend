const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mysql = require('mysql2/promise');

// Initialize express
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MySQL connection
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

// S3 client
const s3Client = new S3Client({
  endpoint: "https://nyc3.digitaloceanspaces.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  },
  forcePathStyle: false
});

// Multer setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload an image.'), false);
    }
  },
});

// Add this helper function at the top of your file
function getCorrectImageUrl(imageUrl) {
  // Fix URLs that have duplicate bucket names
  return imageUrl.replace(
    /https:\/\/bloom-bucket\.bloom-bucket\./,
    'https://bloom-bucket.'
  );
}

// Test endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
  res.json({
    hasSpacesEndpoint: !!process.env.DO_SPACES_ENDPOINT,
    hasSpacesKey: !!process.env.DO_SPACES_KEY,
    hasSpacesSecret: !!process.env.DO_SPACES_SECRET,
    hasSpacesBucket: !!process.env.DO_SPACES_BUCKET,
    endpoint: process.env.DO_SPACES_ENDPOINT
  });
});

// Plants endpoint
app.get('/api/plants', async (req, res) => {
  try {
    console.log('Fetching plants...');
    
    // Get basic plant info
    const [plants] = await pool.execute(`
      SELECT id, name, location, sensitivities 
      FROM plants
    `);
    
    // Get stages for each plant
    const plantsWithStages = await Promise.all(plants.map(async (plant) => {
      const [stages] = await pool.execute(`
        SELECT 
          status,
          DATE_FORMAT(date, '%Y-%m-%d') as date,
          image_url as image
        FROM plant_stages 
        WHERE plant_id = ?
        ORDER BY date
      `, [plant.id]);

      // Fix image URLs in stages
      const fixedStages = stages.map(stage => ({
        ...stage,
        image: getCorrectImageUrl(stage.image)
      }));

      return {
        ...plant,
        sensitivities: plant.sensitivities ? JSON.parse(plant.sensitivities) : [],
        growthStages: fixedStages || []
      };
    }));

    res.json(plantsWithStages);
    
  } catch (error) {
    console.error('Error fetching plants:', error);
    res.status(500).json({ 
      message: 'Error fetching plants', 
      error: error.message 
    });
  }
});

// Image upload endpoint
app.post('/api/plant-stages/upload', upload.single('image'), async (req, res) => {
  try {
    console.log('Upload request received:', {
      file: req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      } : 'No file',
      body: req.body
    });

    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const { status, plantId } = req.body;
    console.log('Processing upload with:', { status, plantId });

    if (!status || !plantId) {
      return res.status(400).json({ 
        message: 'Missing required fields', 
        received: { status, plantId } 
      });
    }

    // First verify the plant exists
    console.log('Verifying plant exists:', plantId);
    const [plants] = await pool.execute(
      'SELECT id FROM plants WHERE id = ?',
      [plantId]
    );

    if (!plants.length) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    // Generate unique filename
    const fileKey = `plants/${plantId}/${uuidv4()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
    console.log('Generated file key:', fileKey);

    try {
      console.log('Attempting S3 upload with:', {
        bucket: process.env.DO_SPACES_BUCKET,
        fileKey,
        contentType: req.file.mimetype
      });

      const command = new PutObjectCommand({
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ACL: 'public-read',
      });

      await s3Client.send(command);
      console.log('S3 upload successful');

      const imageUrl = `https://${process.env.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${fileKey}`;
      console.log('Generated image URL:', imageUrl);

      console.log('Inserting stage into database');
      const [result] = await pool.execute(
        'INSERT INTO plant_stages (plant_id, status, date, image_url) VALUES (?, ?, ?, ?)',
        [plantId, status, new Date().toISOString().split('T')[0], imageUrl]
      );
      console.log('Database insert successful:', result);

      // Get updated plant data
      const [updatedPlant] = await pool.execute(`
        SELECT p.*, 
          (SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', ps.id,
              'status', ps.status,
              'date', DATE_FORMAT(ps.date, '%Y-%m-%d'),
              'image', ps.image_url
            )
          )
          FROM plant_stages ps
          WHERE ps.plant_id = p.id
          ORDER BY ps.date DESC) as growthStages
        FROM plants p
        WHERE p.id = ?
      `, [plantId]);

      const plant = {
        ...updatedPlant[0],
        sensitivities: JSON.parse(updatedPlant[0].sensitivities || '[]'),
        growthStages: JSON.parse(updatedPlant[0].growthStages || '[]').map(stage => ({
          ...stage,
          image: getCorrectImageUrl(stage.image)
        }))
      };

      console.log('Sending successful response');
      res.json({
        message: 'Stage added successfully',
        imageUrl,
        stageId: result.insertId,
        plant
      });

    } catch (uploadError) {
      console.error('S3 upload error details:', {
        error: uploadError,
        message: uploadError.message,
        code: uploadError.code,
        stack: uploadError.stack
      });
      throw new Error(`S3 upload failed: ${uploadError.message}`);
    }

  } catch (error) {
    console.error('Upload error details:', {
      error,
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      message: 'Error uploading image', 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});