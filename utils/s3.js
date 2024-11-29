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

// Enhanced Multer configuration
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

// Enhanced uploadFile function with more parameters
async function uploadFile(file, userId, plantObjId) {
  if (!file || !userId || !plantObjId) {
    throw new Error('Missing required parameters for file upload');
  }

  const fileKey = `plants/${userId}/${plantObjId}/${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
  
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: fileKey,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read',
  }));

  return `https://${process.env.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${fileKey}`;
}

// Delete file from S3
async function deleteFile(fileUrl) {
  if (!fileUrl) {
    throw new Error('File URL is required for deletion');
  }

  const fileKey = fileUrl.split('.com/')[1];
  return s3Client.send(new DeleteObjectCommand({
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: fileKey
  }));
}

module.exports = {
  s3Client,
  upload,
  uploadFile,
  deleteFile
};