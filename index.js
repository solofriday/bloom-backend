// Update just the plants endpoint in your index.js
app.get('/api/plants', async (req, res) => {
  try {
    console.log('Fetching plants...');
    
    // First, get basic plant info
    const [plants] = await pool.execute(`
      SELECT id, name, location, sensitivities 
      FROM plants
    `);
    
    // Then get stages for each plant
    const plantsWithStages = await Promise.all(plants.map(async (plant) => {
      const [stages] = await pool.execute(`
        SELECT 
          status,
          DATE_FORMAT(date, '%Y-%m-%d') as date,
          image_url as image
        FROM plant_stages 
        WHERE plant_id = ?
        ORDER BY date
      `, [plant.id]);

      return {
        ...plant,
        sensitivities: plant.sensitivities ? JSON.parse(plant.sensitivities) : [],
        growthStages: stages
      };
    }));

    console.log('Processed plants:', JSON.stringify(plantsWithStages, null, 2));
    res.json(plantsWithStages);
    
  } catch (error) {
    console.error('Error fetching plants:', error);
    res.status(500).json({ 
      message: 'Error fetching plants', 
      error: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});