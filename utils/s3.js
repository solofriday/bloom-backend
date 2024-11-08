// In index.js, update the S3 client configuration
const s3Client = new S3Client({
  endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  },
  forcePathStyle: true, // Add this
  tls: true,
  // Add this configuration block
  requestHandler: {
    metadata: {
      properties: {
        agent: {
          rejectUnauthorized: false
        }
      }
    }
  }
});

// Update the upload endpoint to include more error details
app.post('/api/plant-stages/upload', upload.single('image'), async (req, res) => {
  try {
    console.log('Upload request received');
    
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    // Log the file details
    console.log('File details:', {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    // Generate unique filename
    const fileKey = `plants/${uuidv4()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
    
    try {
      const command = new PutObjectCommand({
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ACL: 'public-read',
      });

      await s3Client.send(command);
      
      const imageUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${fileKey}`;
      
      res.json({
        message: 'Image uploaded successfully',
        imageUrl,
        fileKey
      });
    } catch (s3Error) {
      console.error('S3 upload error:', s3Error);
      throw new Error(`S3 upload failed: ${s3Error.message}`);
    }

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      message: 'Error uploading image', 
      error: error.message,
      details: error.stack
    });
  }
});