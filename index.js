// In your existing index.js, update/add this endpoint
app.post('/api/plant-stages/upload', upload.single('image'), async (req, res) => {
  try {
    console.log('Upload request received');
    
    if (!req.file) {
      console.log('No file received');
      return res.status(400).json({ message: 'No image file provided' });
    }

    console.log('File received:', {
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Generate unique filename
    const fileKey = `plants/${uuidv4()}-${req.file.originalname.replace(/\s+/g, '-')}`;
    console.log('Generated file key:', fileKey);

    // Upload to DigitalOcean Spaces
    const command = new PutObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read',
    });

    await s3Client.send(command);
    console.log('Upload to Spaces complete');

    const imageUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${fileKey}`;
    
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