if (!process.env.DO_SPACES_BUCKET) {
  throw new Error('DO_SPACES_BUCKET environment variable is required');
}

const SPACES_CONFIG = {
  BUCKET: process.env.DO_SPACES_BUCKET,
  BASE_URL: `https://${process.env.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com`
};

module.exports = SPACES_CONFIG; 