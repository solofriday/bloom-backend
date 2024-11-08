// server/index.js
const express = require('express');
const { upload, processAndUploadImage } = require('./utils/s3');
const authMiddleware = require('./middleware/auth');
const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');

// ... (previous setup code)

// Test endpoint for DigitalOcean Spaces connection
app.get('/api/test-spaces', async (req, res) => {
  try {
    const s3Client = new S3Client({
      endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
      region: "us-east-1", // DigitalOcean Spaces uses this region
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET
      }
    });

    // Try to list buckets to test connection
    const command = new ListBucketsCommand({});
    const response = await s3Client.send(command);

    res.json({
      message: 'Successfully connected to DigitalOcean Spaces',
      buckets: response.Buckets,
      endpoint: process.env.DO_SPACES_ENDPOINT,
      bucket: process.env.DO_SPACES_BUCKET
    });
  } catch (error) {
    console.error('Spaces Error:', error);
    res.status(500).json({
      message: 'Failed to connect to DigitalOcean Spaces',
      error: error.message,
      endpoint: process.env.DO_SPACES_ENDPOINT,
      hasKey: !!process.env.DO_SPACES_KEY,
      hasSecret: !!process.env.DO_SPACES_SECRET
    });
  }
});

// Get user's plants
app.get('/api/plants', authMiddleware, async (req, res) => {
  try {
    const [plants] = await pool.execute(`
      SELECT p.*, 
        (SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', ps.id,
            'status', ps.status,
            'date', ps.date,
            'imageUrl', CONCAT('https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/', psi.file_key)
          )
        )
        FROM plant_stages ps
        LEFT JOIN plant_stage_images psi ON ps.id = psi.stage_id
        WHERE ps.plant_id = p.id) as growthStages
      FROM plants p
      WHERE p.user_id = ?
    `, [req.userId]);

    res.json(plants);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add new plant stage with image
app.post('/api/plants/:plantId/stages', authMiddleware, upload.single('image'), async (req, res) => {
  const { plantId } = req.params;
  const { status, date } = req.body;

  try {
    // Verify plant belongs to user
    const [plants] = await pool.execute(
      'SELECT id FROM plants WHERE id = ? AND user_id = ?',
      [plantId, req.userId]
    );

    if (!plants.length) {
      return res.status(404).json({ message: 'Plant not found or unauthorized' });
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Insert stage
      const [stageResult] = await connection.execute(
        'INSERT INTO plant_stages (plant_id, status, date) VALUES (?, ?, ?)',
        [plantId, status, date]
      );
      const stageId = stageResult.insertId;

      // Process and upload image if provided
      let imageUrl = null;
      if (req.file) {
        const { fileKey, url } = await processAndUploadImage(req.file, req.userId);
        await connection.execute(
          'INSERT INTO plant_stage_images (stage_id, file_key) VALUES (?, ?)',
          [stageId, fileKey]
        );
        imageUrl = url;
      }

      await connection.commit();
      
      res.json({
        id: stageId,
        status,
        date,
        imageUrl
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});