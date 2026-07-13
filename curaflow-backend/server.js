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
  console.log(`System Socket Connection Established: ${socket.id}`);
  
  // Clients join a specific department room to restrict real-time message scope
  socket.on('join_department_room', (departmentId) => {
    Array.from(socket.rooms).forEach(room => {
      if(room.startsWith('dept_')) socket.leave(room);
    });
    socket.join(`dept_${departmentId}`);
    console.log(`Socket ${socket.id} subscribed to department stream room: dept_${departmentId}`);
  });
});

// Helper function to pull the isolated active queue for a specific department room segment
async function getCleanQueue(departmentId) {
  const cleanId = parseInt(departmentId, 10); 
  const queryText = `
    SELECT id, token_number, status, priority, created_at, itinerary_id, step_sequence, doctor_id
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

// --- GENERAL APPLICATION METADATA LOOKUPS ---
app.get('/api/metadata/facilities', async (req, res) => {
  try {
    const depts = await pool.query('SELECT id, name, code FROM departments ORDER BY name ASC');
    const docs = await pool.query('SELECT id, name, department_id, room_number FROM doctors WHERE is_available = true');
    res.json({ departments: depts.rows, doctors: docs.rows });
  } catch (err) {
    res.status(500).send("Metadata retrieval error");
  }
});

// --- AUTHENTICATION ENDPOINTS (WITH TRANSACTIONAL EXTRACTION LOGIC) ---
app.post('/api/auth/signup', async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, email, password, role, departmentId, roomNumber } = req.body;
    
    await client.query('BEGIN');

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userResult = await client.query(
      `INSERT INTO users (username, email, password_hash, role) 
       VALUES ($1, $2, $3, $4) RETURNING id, username, email, role`,
      [username, email, passwordHash, role]
    );
    
    const newUser = userResult.rows[0];

    if (role === 'DOCTOR') {
      if (!departmentId || !roomNumber) {
        throw new Error("Doctor profiles require explicit department and room allocation parameters.");
      }

      await client.query(
        `INSERT INTO doctors (name, department_id, is_available, room_number, user_id) 
         VALUES ($1, $2, true, $3, $4)`,
        [username, parseInt(departmentId, 10), roomNumber, newUser.id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ message: "User profile successfully instantiated", user: newUser });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Signup Transaction Aborted:", err.message);
    res.status(500).json({ error: "Registration processing trace fault", details: err.message });
  } finally {
    client.release();
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

    let doctorContext = null;
    if (user.role === 'DOCTOR') {
      const docRes = await pool.query('SELECT id, name, department_id, room_number FROM doctors WHERE user_id = $1', [user.id]);
      if (docRes.rows.length > 0) doctorContext = docRes.rows[0];
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        role: user.role,
        doctorInfo: doctorContext 
      } 
    });
  } catch (err) {
    res.status(500).send("Login server error");
  }
});

// --- LOGISTICS COMPONENT: APPOINTMENT BOOKING ENGINE ---
app.post('/api/itinerary/create', async (req, res) => {
  try {
    const { patientId, departmentId, doctorId, priority } = req.body;

    const newItinerary = await pool.query(
      `INSERT INTO patient_itineraries (patient_id) VALUES ($1) RETURNING id`, [patientId]
    );
    const itineraryId = newItinerary.rows[0].id;
    const generatedToken = `CF-${Math.floor(1000 + Math.random() * 9000)}`;

    await pool.query(
      `INSERT INTO itinerary_steps (itinerary_id, department_id, doctor_id, step_sequence, priority, token_number, status) 
       VALUES ($1, $2, $3, 1, $4, $5, 'WAITING')`,
      [itineraryId, departmentId, doctorId, priority || 'MEDIUM', generatedToken]
    );

    const freshData = await getCleanQueue(departmentId);
    io.to(`dept_${departmentId}`).emit('queue_updated', { departmentId, queue: freshData });
    io.emit('patient_movement_trigger', { itineraryId });

    res.json({ message: "Appointment registered!", token: generatedToken });
  } catch (err) {
    console.error(err);
    res.status(500).send("Appointment generation fault");
  }
});

// --- DATA READ ENDPOINTS ---
app.get('/api/doctor/queue/:doctorId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, token_number, status, priority, itinerary_id, step_sequence, department_id 
      FROM itinerary_steps
      WHERE doctor_id = $1 AND status IN ('WAITING', 'CALLED', 'IN_CONSULTATION')
      ORDER BY CASE priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 END ASC, created_at ASC`,
      [req.params.doctorId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error reading operator lineup");
  }
});

app.get('/api/itinerary/patient/:patientId', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.token_number, d.name as department_name, doc.name as doctor_name, s.status, s.step_sequence, s.priority, doc.room_number
      FROM itinerary_steps s
      JOIN departments d ON s.department_id = d.id
      JOIN doctors doc ON s.doctor_id = doc.id
      JOIN patient_itineraries i ON s.itinerary_id = i.id
      WHERE i.patient_id = $1 AND i.date = CURRENT_DATE
      ORDER BY s.step_sequence ASC`, 
      [req.params.patientId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error fetching patient timeline profile");
  }
});

app.get('/api/queue/:deptId', async (req, res) => {
  try {
    const data = await getCleanQueue(req.params.deptId);
    res.json(data);
  } catch (err) {
    res.status(500).send("Server Error");
  }
});

// --- DISPATCH ACTIONS ---
app.patch('/api/queue/next', async (req, res) => {
  try {
    const { doctorId, departmentId } = req.body;

    const findNextPatientQuery = `
      SELECT id, itinerary_id FROM itinerary_steps 
      WHERE doctor_id = $1 AND department_id = $2 AND status = 'WAITING'
      ORDER BY CASE priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 END ASC, 
      created_at ASC LIMIT 1;
    `;
    const nextPatientResult = await pool.query(findNextPatientQuery, [doctorId, departmentId]);
    if (nextPatientResult.rows.length === 0) return res.json({ message: "Queue Clear." });

    const currentStep = nextPatientResult.rows[0];
    await pool.query(
      `UPDATE itinerary_steps SET status = 'CALLED', called_at = CURRENT_TIMESTAMP WHERE id = $1`, [currentStep.id]
    );

    const freshQueueData = await getCleanQueue(departmentId);
    io.to(`dept_${departmentId}`).emit('queue_updated', { departmentId, queue: freshQueueData });
    io.emit('patient_movement_trigger', { itineraryId: currentStep.itinerary_id });

    res.json({ message: "Patient Called Successfully" });
  } catch (err) {
    res.status(500).send("Dispatch transaction fault");
  }
});

app.post('/api/queue/complete', async (req, res) => {
  try {
    const { stepId, itineraryId, departmentId } = req.body;
    await pool.query(`UPDATE itinerary_steps SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [stepId]);

    const freshCurrentDeptData = await getCleanQueue(departmentId);
    io.to(`dept_${departmentId}`).emit('queue_updated', { departmentId, queue: freshCurrentDeptData });
    io.emit('patient_movement_trigger', { itineraryId });

    res.json({ message: "Checkup complete." });
  } catch (err) {
    res.status(500).send("Discharge event tracking fault");
  }
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`CURAFLOW Central Network Hub live on http://127.0.0.1:${PORT}`);
});