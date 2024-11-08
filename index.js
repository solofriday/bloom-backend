const express = require('express');
const cors = require('cors');
const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');

const app = express();
app.use(cors());
app.use(express.json());

// Basic test endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Spaces test endpoint
app.get('/api/test-spaces', async (req, res) => {
  try {
    const s3Client = new S3Client({
      endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET
      }
    });

    console.log('Testing Spaces connection...');
    console.log('Endpoint:', process.env.DO_SPACES_ENDPOINT);
    console.log('Has Key:', !!process.env.DO_SPACES_KEY);
    console.log('Has Secret:', !!process.env.DO_SPACES_SECRET);

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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});