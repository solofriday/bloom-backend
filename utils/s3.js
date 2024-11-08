// index.js - update the S3 client configuration and upload endpoint
const s3Client = new S3Client({
  endpoint: `https://nyc3.digitaloceanspaces.com`, // Direct endpoint
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  },
  forcePathStyle: false // Changed to false
});

// Update the upload endpoint
app.post('/api/plant-stages/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    // Generate unique filename
    const fileKey = `plants/${uuidv4()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
    
    const command = new PutObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read',
    });

    await s3Client.send(command);
    
    // Construct the correct URL format
    const imageUrl = `https://${process.env.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${fileKey}`;
    
    res.json({
      message: 'Image uploaded successfully',
      imageUrl,
      fileKey
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      message: 'Error uploading image', 
      error: error.message
    });
  }
});