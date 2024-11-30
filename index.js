require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { upload, uploadFile, deleteFile, getFileKey } = require('./utils/s3');
const SPACES_CONFIG = require('./config/spaces');

// Now we can log
console.log('SPACES_CONFIG:', {
  bucket: SPACES_CONFIG.BUCKET,
  baseUrl: SPACES_CONFIG.BASE_URL
});

// Initialize express
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MySQL connection pool with optimized settings
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '25060'),
  ssl: { rejectUnauthorized: false },
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// API endpoints...

// Updated API endpoint to get plants with stages and locations
app.get('/api/plants', async (req, res) => {
  const userId = req.query.userId || null;
  const status = req.query.status || null;

  try {
    console.log('Fetching plants with stages, locations, and photos...');
    const [results] = await pool.execute('CALL GetPlantsWithStagesAndLocations(?, ?)', [userId, status]);
    
    const plants = results[0].map(plant => {
      try {
        // Parse JSON strings only if they're not already objects
        const plant_data = typeof plant.plant === 'string' ? JSON.parse(plant.plant) : plant.plant;
        const variety = typeof plant.variety === 'string' ? JSON.parse(plant.variety) : plant.variety;
        const stage = typeof plant.stage === 'string' ? JSON.parse(plant.stage) : plant.stage;
        const location = typeof plant.location === 'string' ? JSON.parse(plant.location) : plant.location;
        const photos = typeof plant.photos === 'string' ? JSON.parse(plant.photos) : (plant.photos || []);
        const notes = typeof plant.notes === 'string' ? JSON.parse(plant.notes) : (plant.notes || []);
        const warning = typeof plant.warning === 'string' ? JSON.parse(plant.warning) : (plant.warning || {
          cold_tolerance: null,
          heat_tolerance: null
        });

        // Normalize photo structure - REMOVE URL CONSTRUCTION
        const normalizedPhotos = photos.map(photo => ({
          id: photo.photo_id,  // Map photo_id to id
          filename: photo.filename,  // Just return filename
          date_taken: photo.date_taken,
          date_uploaded: photo.date_uploaded,
          stage: photo.stage
        }));

        return {
          plant_obj_id: plant.plant_obj_id,
          user_id: plant.user_id,
          plant: plant_data,
          variety,
          stage,
          location,
          photos: normalizedPhotos,  // Use normalized photos without URLs
          notes,
          warning,
          date_updated: plant.date_updated,
          date_planted: plant.date_planted,
          is_transplant: plant.is_transplant,
          status: plant.status,
          current_temp: plant.current_temp
        };
      } catch (parseError) {
        console.error('Error parsing plant data:', parseError, {
          plantId: plant.plant_obj_id,
          rawData: plant
        });
        return {
          plant_obj_id: plant.plant_obj_id,
          user_id: plant.user_id,
          plant: {},
          variety: {},
          stage: {},
          location: {},
          photos: [],
          notes: [],
          warning: {
            cold_tolerance: null,
            heat_tolerance: null
          },
          date_updated: plant.date_updated,
          date_planted: plant.date_planted,
          is_transplant: plant.is_transplant,
          status: plant.status,
          current_temp: plant.current_temp,
        };
      }
    });

    console.log('Sending structured plants data:', plants);
    res.json(plants);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      message: 'Error fetching plants', 
      error: error.message 
    });
  }
});

// Add this new endpoint after the existing endpoints
app.get('/api/stages', async (req, res) => {
  try {
    console.log('Fetching all stages...');
    const [results] = await pool.execute('CALL GetAllStages()');
    
    // The first element contains our result set
    const stages = results[0].map(stage => ({
      id: stage.id,
      name: stage.name,
      description: stage.description
    }));

    res.json(stages);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      message: 'Error fetching stages', 
      error: error.message 
    });
  }
});

// Add this new endpoint for getting varieties by plant
app.get('/api/varieties', async (req, res) => {
  const plantId = req.query.plantId;
  const search = req.query.search === undefined ? null : req.query.search;

  try {
    console.log('Fetching varieties for plant:', plantId, 'with search:', search);
    const [results] = await pool.execute('CALL GetVarietiesByPlant(?, ?)', [plantId, search]);
    
    // The first element contains our result set
    const varieties = results[0].map(variety => ({
      id: variety.id,
      name: variety.name
    }));

    res.json(varieties);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      message: 'Error fetching varieties', 
      error: error.message 
    });
  }
});

// Review of existing GetAllPlants endpoint
app.get('/api/all-plants', async (req, res) => {
  try {
    console.log('Fetching all plants...');
    const [results] = await pool.execute('CALL GetAllPlants()');
    
    // The first element contains our result set
    const plants = results[0].map(plant => ({
      id: plant.id,
      name: plant.name
    }));

    res.json(plants);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      message: 'Error fetching plants', 
      error: error.message 
    });
  }
});

// Add this new endpoint for getting locations
app.get('/api/locations', async (req, res) => {
  const search = req.query.search === undefined ? null : req.query.search;

  try {
    console.log('Fetching locations with search:', search);
    const [results] = await pool.execute('CALL GetLocationsBySearch(?)', [search]);
    
    // The first element contains our result set
    const locations = results[0].map(location => ({
      id: location.id,
      name: location.name
    }));

    res.json(locations);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      message: 'Error fetching locations', 
      error: error.message 
    });
  }
});

// Add this new endpoint for updating plant objects
app.post('/api/plants/update', async (req, res) => {
  try {
    const {
      plantObjId,
      userId,
      newVarietyId,
      newLocationId,
      newStageId,
      newDatePlanted,
      newIsTransplant,
      newStatus
    } = req.body;

    // Detailed logging of received data
    console.log('Raw request body:', req.body);
    console.log('Parsed values:', {
      plantObjId: typeof plantObjId + ' -> ' + plantObjId,
      userId: typeof userId + ' -> ' + userId,
      newVarietyId: typeof newVarietyId + ' -> ' + newVarietyId,
      newLocationId: typeof newLocationId + ' -> ' + newLocationId,
      newStageId: typeof newStageId + ' -> ' + newStageId,
      newDatePlanted: typeof newDatePlanted + ' -> ' + newDatePlanted,
      newIsTransplant: typeof newIsTransplant + ' -> ' + newIsTransplant,
      newStatus: typeof newStatus + ' -> ' + newStatus
    });

    const [result] = await pool.execute(
      'CALL UpdatePlantObj(?, ?, ?, ?, ?, ?, ?, ?)',
      [
        plantObjId,
        userId,
        newVarietyId,
        newLocationId,
        newStageId,
        newDatePlanted,
        newIsTransplant,
        newStatus
      ]
    );

    console.log('SQL execution result:', result);

    res.json({
      success: true,
      message: 'Plant object updated successfully',
      plantObjId
    });

  } catch (error) {
    console.error('Detailed error:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({
      message: 'Error updating plant object',
      error: error.message,
      details: {
        code: error.code,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage
      }
    });
  }
});

// Update endpoint for getting notes for a specific plant
app.get('/api/notes/:userId/:plantObjId', async (req, res) => {
  try {
    const { userId, plantObjId } = req.params;
    console.log('Fetching notes for plant:', plantObjId, 'user:', userId);
    
    const [results] = await pool.execute('CALL GetAllNotes(?, ?)', [userId, plantObjId]);
    
    // Transform the results to use note_id instead of id
    const notes = results[0].map(note => ({
      note_id: note.id,  // Map id to note_id
      content: note.content,
      timestamp: note.timestamp
    }));
    
    res.json(notes);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      message: 'Error fetching notes', 
      error: error.message 
    });
  }
});

// Add endpoint for adding a new note
app.post('/api/notes/add', async (req, res) => {
  try {
    const {
      userId,
      plantObjId,
      content
    } = req.body;

    console.log('Adding new note - Request:', {
      userId,
      plantObjId,
      content
    });

    const [results] = await pool.execute(
      'CALL AddNote(?, ?, ?)',
      [
        userId,
        plantObjId,
        content
      ]
    );

    // The SP returns newNoteId in the first row of the first result set
    const noteId = results[0][0]?.newNoteId;

    if (!noteId) {
      console.error('Note ID not found in SP results:', results);
      throw new Error('Failed to get note ID from stored procedure');
    }

    const response = {
      success: true,
      message: 'Note added successfully',
      note: {
        note_id: noteId,
        content,
        timestamp: new Date().toISOString()
      }
    };

    console.log('Sending response:', response);
    res.json(response);

  } catch (error) {
    console.error('Error in /notes/add:', {
      error,
      message: error.message,
      stack: error.stack,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState
    });
    res.status(500).json({
      message: 'Error adding note',
      error: error.message
    });
  }
});

// Update endpoint for updating a note
app.post('/api/notes/update', async (req, res) => {
  try {
    const {
      userId,
      plantObjId,
      noteId,
      newContent
    } = req.body;

    console.log('Updating note - Request:', {
      userId,
      plantObjId,
      noteId,
      newContent
    });

    const [results] = await pool.execute(
      'CALL UpdateNote(?, ?, ?, ?)',
      [
        userId,
        plantObjId,
        noteId,
        newContent
      ]
    );

    console.log('UpdateNote SP Results:', results);

    const response = {
      success: true,
      message: 'Note updated successfully',
      noteId
    };

    console.log('Sending response:', response);
    res.json(response);

  } catch (error) {
    console.error('Error in /notes/update:', {
      error,
      message: error.message,
      stack: error.stack,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState
    });
    res.status(500).json({
      message: 'Error updating note',
      error: error.message
    });
  }
});

// Update endpoint for deleting a note
app.delete('/api/notes/:userId/:plantObjId/:noteId', async (req, res) => {
  try {
    const { userId, plantObjId, noteId } = req.params;

    // Convert parameters to integers
    const userIdInt = parseInt(userId);
    const plantObjIdInt = parseInt(plantObjId);
    const noteIdInt = parseInt(noteId);

    console.log('Deleting note - Parameters:', {
      userId: userIdInt,
      plantObjId: plantObjIdInt,
      noteId: noteIdInt
    });

    const [results] = await pool.execute(
      'CALL DeleteNote(?, ?, ?)',
      [userIdInt, plantObjIdInt, noteIdInt]
    );

    console.log('DeleteNote SP Results:', results);

    // Check if any rows were affected
    const affectedRows = results.affectedRows || 0;
    
    if (affectedRows === 0) {
      console.log('No note was deleted - Note might not exist or belong to user');
      return res.status(404).json({
        success: false,
        message: 'Note not found or not authorized to delete'
      });
    }

    const response = {
      success: true,
      message: 'Note deleted successfully',
      note_id: noteIdInt  // Changed from noteId to note_id for consistency
    };

    console.log('Sending response:', response);
    res.json(response);

  } catch (error) {
    console.error('Error in /notes/delete:', {
      error,
      message: error.message,
      stack: error.stack,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState
    });
    res.status(500).json({
      success: false,
      message: 'Error deleting note',
      error: error.message
    });
  }
});

// Update endpoint for getting photos for a specific plant
app.get('/api/photos/:userId/:plantObjId', async (req, res) => {
  const { userId, plantObjId } = req.params;

  try {
    const [rows] = await pool.query(
      'CALL GetPhotos(?, ?)',
      [parseInt(userId), parseInt(plantObjId)]
    );

    // Just return the raw data, no URL construction
    const photos = rows[0].map(photo => ({
      ...photo,
      stage: photo.stage ? 
        (typeof photo.stage === 'string' ? JSON.parse(photo.stage) : photo.stage) 
        : null
    }));

    res.json(photos);

  } catch (error) {
    console.error('Error fetching photos:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch photos',
      error: error.message 
    });
  }
});

// Update the photos/add endpoint
app.post('/api/photos/add', upload.single('image'), async (req, res) => {
  try {
    const { userId, plantObjId, stageId, dateTaken } = req.body;
    console.log('Adding photo with params:', { userId, plantObjId, stageId, dateTaken });

    if (!req.file || !userId || !plantObjId) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Upload to S3 - now returns just the filename
    const filename = await uploadFile(req.file, userId, plantObjId);

    let photoDate = dateTaken ? new Date(dateTaken) : new Date();
    const parsedStageId = stageId ? parseInt(stageId) : null;

    // Call AddPhoto SP with just the filename
    const [result] = await pool.execute(
      'CALL AddPhoto(?, ?, ?, ?, ?)',
      [parseInt(userId), parseInt(plantObjId), filename, photoDate, parsedStageId]
    );

    // Extract the photo data from the SP result
    const photoData = result[0][0];
    console.log('SP Result:', photoData);

    // Parse the stage JSON if it exists
    const stage = photoData.stage ? 
      (typeof photoData.stage === 'string' ? JSON.parse(photoData.stage) : photoData.stage) 
      : null;

    const response = {
      success: true,
      photo: {
        photo_id: photoData.photo_id,
        filename: filename,
        date_taken: photoDate.toISOString(),
        date_uploaded: new Date().toISOString(),
        stage: stage
      }
    };

    console.log('Sending response:', response);
    res.json(response);

  } catch (error) {
    console.error('Error adding photo:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error adding photo',
      error: error.message 
    });
  }
});

// Update the photo deletion endpoint
app.delete('/api/photos/:userId/:plantObjId/:photoId', async (req, res) => {
  const { userId, plantObjId, photoId } = req.params;

  try {
    // Call DeletePhoto SP which now returns both photo_id and filename
    const [results] = await pool.execute(
      'CALL DeletePhoto(?, ?, ?)',
      [parseInt(userId), parseInt(plantObjId), parseInt(photoId)]
    );

    const deletedPhoto = results[0]?.[0];
    if (!deletedPhoto?.deleted_photo_id || !deletedPhoto?.filename) {
      return res.status(404).json({
        success: false,
        message: 'Photo not found'
      });
    }

    // Delete from S3 using the returned filename
    await deleteFile(userId, plantObjId, deletedPhoto.filename);

    res.json({
      success: true,
      message: 'Photo deleted successfully',
      photoId: deletedPhoto.deleted_photo_id
    });

  } catch (error) {
    console.error('Error deleting photo:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete photo',
      error: error.message
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));

