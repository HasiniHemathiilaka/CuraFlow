const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors'); 
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "curaflow_super_secure_secret_key";

app.use(cors()); 
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } 
});

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'CuraFlow',       
  password: '1234', 
  port: 5432,
});

io.on('connection', (socket) => {
  console.log(`System Alert: Session connected! ID: ${socket.id}`);
});

// --- HELPER FUNCTION: GET ACTIVE QUEUE FOR A SPECIFIC WARD ---
async function getCleanQueue(departmentId) {
  const cleanId = parseInt(departmentId, 10); 
  const queryText = `
    SELECT id, token_number, status, priority, created_at, itinerary_id, step_sequence
    FROM itinerary_steps 
    WHERE department_id = $1 AND status IN ('WAITING', 'CALLED', 'IN_CONSULTATION')
    ORDER BY 
      CASE priority 
        WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 
      END ASC, created_at ASC;
  `;
  const result = await pool.query(queryText, [cleanId]);
  return result.rows;
}

// --- AUTHENTICATION ENDPOINTS ---
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role`,
      [username, email, passwordHash, role]
    );

    res.status(201).json({ message: "User registered successfully", user: newUser.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Registration error (User might already exist)");
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (userResult.rows.length === 0) return res.status(400).json({ error: "Invalid Credentials" });
    
    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(400).json({ error: "Invalid Credentials" });

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).send("Login server error");
  }
});

// --- PATIENT ROUTING SYSTEM ENGINE (GENERATE SYSTEM ITINERARY) ---
app.post('/api/itinerary/create', async (req, res) => {
  try {
    const { patientId, departmentIds, priority } = req.body; // e.g., departmentIds = [1, 3] (Cardiology, Scans)

    // 1. Instantiate Parent Itinerary
    const newItinerary = await pool.query(
      `INSERT INTO patient_itineraries (patient_id) VALUES ($1) RETURNING id`, [patientId]
    );
    const itineraryId = newItinerary.rows[0].id;
    const generatedToken = `CF-${Math.floor(1000 + Math.random() * 9000)}`;

    // 2. Optimization Rule Strategy: Sort target sequences based on least crowded departments
    const countsResult = await pool.query(
      `SELECT department_id, COUNT(*) as count FROM itinerary_steps WHERE status = 'WAITING' GROUP BY department_id`
    );
    const countMap = {};
    countsResult.rows.forEach(row => { countMap[row.department_id] = parseInt(row.count, 10); });

    const sortedDepts = departmentIds.sort((a, b) => (countMap[a] || 0) - (countMap[b] || 0));

    // 3. Populate sequences sequentially into the DB
    for (let i = 0; i < sortedDepts.length; i++) {
      await pool.query(
        `INSERT INTO itinerary_steps (itinerary_id, department_id, step_sequence, priority, token_number, status) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [itineraryId, sortedDepts[i], i + 1, priority || 'MEDIUM', generatedToken, i === 0 ? 'WAITING' : 'WAITING']
      );
    }

    // Broadcast the initial update to the first department's display room board
    const freshData = await getCleanQueue(sortedDepts[0]);
    io.emit('queue_updated', { departmentId: sortedDepts[0], queue: freshData });

    res.json({ message: "Routing plan established!", token: generatedToken, itineraryId });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to create routing ticket tracking strategy");
  }
});

// --- PATIENT: FETCH PERSONAL DAILY TIMELINE TRACKER ---
app.get('/api/itinerary/patient/:patientId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.token_number, d.name as department_name, s.status, s.step_sequence, s.priority
      FROM itinerary_steps s
      JOIN departments d ON s.department_id = d.id
      JOIN patient_itineraries i ON s.itinerary_id = i.id
      WHERE i.patient_id = $1 AND i.date = CURRENT_DATE
      ORDER BY s.step_sequence ASC`, 
      [req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error reading live tracking context");
  }
});

// --- COMPATIBILITY ENDPOINTS (ADAPTED FOR THE NEW ITINERARY SCHEMA) ---
app.get('/api/queue/:deptId', async (req, res) => {
  try {
    const data = await getCleanQueue(req.params.deptId);
    res.json(data);
  } catch (err) {
    res.status(500).send("Server Error fetching queue");
  }
});

// PATCH endpoint triggered by Doctors to call the next patient
app.patch('/api/queue/next', async (req, res) => {
  try {
    const { doctorId, departmentId } = req.body;
    const cleanDeptId = parseInt(departmentId, 10);

    const findNextPatientQuery = `
      SELECT id, itinerary_id, step_sequence FROM itinerary_steps 
      WHERE department_id = $1 AND status = 'WAITING'
      ORDER BY CASE priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 END ASC, 
      created_at ASC LIMIT 1;
    `;
    const nextPatientResult = await pool.query(findNextPatientQuery, [cleanDeptId]);

    if (nextPatientResult.rows.length === 0) {
      return res.json({ message: "No patients waiting in this ward segment." });
    }

    const currentStep = nextPatientResult.rows[0];

    // Transition the current step from WAITING to CALLED
    const updateCurrentStep = await pool.query(
      `UPDATE itinerary_steps SET status = 'CALLED', doctor_id = $1, called_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING token_number, status`,
      [doctorId, currentStep.id]
    );

    const freshQueueData = await getCleanQueue(cleanDeptId);
    io.emit('queue_updated', { departmentId: cleanDeptId, queue: freshQueueData });
    io.emit('patient_movement_trigger', { itineraryId: currentStep.itinerary_id });

    res.json({ message: "Dispatched successfully", patient: updateCurrentStep.rows[0] });
  } catch (err) {
    res.status(500).send("Server Error updating tracking steps");
  }
});

// --- NEW ACTION TRIGGER: COMPLETING A STEP AND ROUTING TO NEXT LOCATION ---
app.post('/api/queue/complete', async (req, res) => {
  try {
    const { stepId, itineraryId, currentSequence, departmentId } = req.body;

    // 1. Complete current operation status block
    await pool.query(
      `UPDATE itinerary_steps SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [stepId]
    );

    // 2. Inform the current department board that the patient left
    const freshCurrentDeptData = await getCleanQueue(departmentId);
    io.emit('queue_updated', { departmentId, queue: freshCurrentDeptData });

    // 3. Fetch the next scheduled step for this patient's routing plan
    const nextStepResult = await pool.query(
      `SELECT department_id FROM itinerary_steps WHERE itinerary_id = $1 AND step_sequence = $2`,
      [itineraryId, parseInt(currentSequence, 10) + 1]
    );

    if (nextStepResult.rows.length > 0) {
      const nextDeptId = nextStepResult.rows[0].department_id;
      const freshNextDeptData = await getCleanQueue(nextDeptId);
      // Let the next ward know someone is heading their way
      io.emit('queue_updated', { departmentId: nextDeptId, queue: freshNextDeptData });
    }

    io.emit('patient_movement_trigger', { itineraryId });
    res.json({ message: "Step completed. Patient advanced." });
  } catch (err) {
    res.status(500).send("Engine error managing transfer context");
  }
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`CURA FLOW Engine upgraded: live on http://localhost:${PORT}`);
});