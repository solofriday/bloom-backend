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
  endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  }
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

      return {
        ...plant,
        sensitivities: plant.sensitivities ? JSON.parse(plant.sensitivities) : [],
        growthStages: stages || []
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
    console.log('Upload request received');
    console.log('Headers:', req.headers);
    
    if (!req.file) {
      console.log('No file received');
      return res.status(400).json({ message: 'No image file provided' });
    }

    console.log('File received:', {
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      buffer: req.file.buffer ? 'Buffer present' : 'No buffer'
    });

    // Log Space credentials (don't log actual values)
    console.log('Space config:', {
      hasEndpoint: !!process.env.DO_SPACES_ENDPOINT,
      hasBucket: !!process.env.DO_SPACES_BUCKET,
      hasKey: !!process.env.DO_SPACES_KEY,
      hasSecret: !!process.env.DO_SPACES_SECRET
    });

    // Generate unique filename
    const fileKey = `plants/${uuidv4()}-${req.file.originalname.replace(/\s+/g, '-')}`;
    console.log('Generated file key:', fileKey);

    try {
      // Upload to DigitalOcean Spaces
      const command = new PutObjectCommand({
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ACL: 'public-read',
      });

      console.log('Attempting S3 upload...');
      await s3Client.send(command);
      console.log('Upload to Spaces complete');

      // Use the standard DigitalOcean Spaces URL format
      const imageUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${fileKey}`;
      console.log('Generated image URL:', imageUrl);
      
      res.json({
        message: 'Image uploaded successfully',
        imageUrl,
        fileKey
      });
    } catch (uploadError) {
      console.error('S3 upload error:', uploadError);
      throw new Error(`S3 upload failed: ${uploadError.message}`);
    }

  } catch (error) {
    console.error('Upload error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    res.status(500).json({ 
      message: 'Error uploading image', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});