const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// S3 client configuration
const s3Client = new S3Client({
  endpoint: "https://nyc3.digitaloceanspaces.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  }
});

// Multer configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload an image.'), false);
    }
  },
});

function getFileKey(userId, plantObjId, filename) {
  return `plants/${userId}/${plantObjId}/${filename}`;
}

async function uploadFile(file, userId, plantObjId) {
  if (!file || !userId || !plantObjId) {
    throw new Error('Missing required parameters for file upload');
  }

  // Generate just the filename portion
  const filename = `${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
  
  // Get full path for S3
  const fullPath = getFileKey(userId, plantObjId, filename);
  
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: fullPath,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read',
  }));

  // Return just the filename
  return filename;
}

async function deleteFile(userId, plantObjId, filename) {
  if (!filename) {
    throw new Error('Filename is required for deletion');
  }

  const fullPath = getFileKey(userId, plantObjId, filename);
  
  return s3Client.send(new DeleteObjectCommand({
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: fullPath
  }));
}

module.exports = {
  s3Client,
  upload,
  uploadFile,
  deleteFile,
  getFileKey
};