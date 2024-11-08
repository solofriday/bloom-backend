const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();

// Update CORS configuration to be more permissive for testing
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ message: 'Server error', error: err.message });
});

// Configure multer for memory storage
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

// Initialize S3 client
const s3Client = new S3Client({
  endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  }
});

// Test endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Add debug endpoint to check environment variables
app.get('/api/debug', (req, res) => {
  res.json({
    hasSpacesEndpoint: !!process.env.DO_SPACES_ENDPOINT,
    hasSpacesKey: !!process.env.DO_SPACES_KEY,
    hasSpacesSecret: !!process.env.DO_SPACES_SECRET,
    hasSpacesBucket: !!process.env.DO_SPACES_BUCKET,
    endpoint: process.env.DO_SPACES_ENDPOINT
  });
});

// Image upload endpoint with better error handling
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    console.log('Upload request received');
    
    if (!req.file) {
      console.log('No file received');
      return res.status(400).json({ message: 'No image file provided' });
    }

    console.log('File received:', {
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Generate unique filename
    const fileKey = `plants/${uuidv4()}.webp`;
    console.log('Generated file key:', fileKey);

    // Process image with sharp
    console.log('Processing image...');
    const processedImageBuffer = await sharp(req.file.buffer)
      .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    console.log('Image processed');

    // Upload to DigitalOcean Spaces
    console.log('Uploading to Spaces...');
    const command = new PutObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: fileKey,
      Body: processedImageBuffer,
      ContentType: 'image/webp',
      ACL: 'public-read',
    });

    await s3Client.send(command);
    console.log('Upload to Spaces complete');

    // Return the public URL
    const imageUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${fileKey}`;
    
    console.log('Returning success response');
    res.json({
      message: 'Image uploaded successfully',
      imageUrl,
      fileKey
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      message: 'Error uploading image', 
      error: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

// MySQL connection and pool setup
const mysql = require('mysql2/promise');

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

// Get all plants endpoint with error handling
app.get('/api/plants', async (req, res) => {
  try {
    console.log('Fetching plants...');
    const [plants] = await pool.execute(`
      SELECT p.*, 
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
    
    console.log('Plants fetched:', plants.length);
    
    // Parse JSON strings
    const processedPlants = plants.map(plant => ({
      ...plant,
      sensitivities: JSON.parse(plant.sensitivities || '[]'),
      growthStages: JSON.parse(plant.growthStages || '[]').filter(Boolean) // Remove null values
    }));

    res.json(processedPlants);
  } catch (error) {
    console.error('Error fetching plants:', error);
    res.status(500).json({ 
      message: 'Error fetching plants', 
      error: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log('Environment:', {
    hasSpacesEndpoint: !!process.env.DO_SPACES_ENDPOINT,
    hasSpacesKey: !!process.env.DO_SPACES_KEY,
    hasSpacesSecret: !!process.env.DO_SPACES_SECRET,
    hasSpacesBucket: !!process.env.DO_SPACES_BUCKET,
    hasDatabaseConfig: !!(process.env.DB_HOST && process.env.DB_USER)
  });
});