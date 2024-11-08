// server/utils/s3.js
const { S3Client } = require('@aws-sdk/client-s3');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

// Initialize S3 client
const s3Client = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT, // e.g., 'nyc3.digitaloceanspaces.com'
  region: 'us-east-1',  // DigitalOcean Spaces uses this
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  }
});

// Multer memory storage for temporary file handling
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

// Image processing and upload function
const processAndUploadImage = async (file, userId) => {
  // Generate unique filename
  const fileKey = `users/${userId}/plants/${uuidv4()}.webp`;
  
  // Process image with sharp
  const processedImageBuffer = await sharp(file.buffer)
    .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  // Upload to DigitalOcean Spaces
  const command = new PutObjectCommand({
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: fileKey,
    Body: processedImageBuffer,
    ContentType: 'image/webp',
    ACL: 'public-read',
  });

  await s3Client.send(command);

  return {
    fileKey,
    url: `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${fileKey}`
  };
};

module.exports = { upload, processAndUploadImage };