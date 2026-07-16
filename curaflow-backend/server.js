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
const io = new Server(server, { cors: { origin: "*" } });

// UPDATED: Dynamically uses Docker internal network alias via DATABASE_URL environment parameter fallback
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:1234@localhost:5432/CuraFlow'
});

io.on('connection', (socket) => {
  console.log(`System Socket Connection Established: ${socket.id}`);

  socket.on('join_department_room', (departmentId) => {
    Array.from(socket.rooms).forEach(room => { if(room.startsWith('dept_')) socket.leave(room); });
    socket.join(`dept_${departmentId}`);
    console.log(`Socket ${socket.id} joined department TV room: dept_${departmentId}`);
  });

  socket.on('register_user_notification_channel', (userId) => {
    Array.from(socket.rooms).forEach(room => { if(room.startsWith('user_')) socket.leave(room); });
    socket.join(`user_${userId}`);
    console.log(`Socket ${socket.id} mapped to private channel: user_${userId}`);
  });
});

// --- HELPER: CALCULATE HOSPITAL OPERATIONAL DAY WINDOW (08:00 to 08:00) ---
function getOperationalWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(8, 0, 0, 0);
  if (now.getHours() < 8) {
    start.setDate(start.getDate() - 1);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Upgraded to pull detailed step arrays within the active 24-hour window
async function getCleanQueue(departmentId) {
  const { start, end } = getOperationalWindow();
  const queryText = `
    SELECT s.id, s.token_number, s.status, s.priority, s.created_at, s.itinerary_id, s.step_sequence, s.doctor_id, d.name as doctor_name, d.room_number
    FROM itinerary_steps s
    JOIN doctors d ON s.doctor_id = d.id
    WHERE s.department_id = $1 
      AND s.status IN ('WAITING', 'CALLED', 'IN_CONSULTATION')
      AND s.created_at >= $2 AND s.created_at < $3
    ORDER BY CASE s.priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 END ASC, s.created_at ASC;
  `;
  const result = await pool.query(queryText, [parseInt(departmentId, 10), start, end]);
  return result.rows;
}

// --- NEW HELPER: DYNAMIC ETA ENGINE ---
async function getDoctorAverageSpeed(doctorId, start, end) {
  const queryText = `
    SELECT EXTRACT(EPOCH FROM (completed_at - called_at))/60 as duration
    FROM itinerary_steps
    WHERE doctor_id = $1 
      AND status = 'COMPLETED' 
      AND called_at IS NOT NULL 
      AND completed_at IS NOT NULL
      AND created_at >= $2 AND created_at < $3;
  `;
  const res = await pool.query(queryText, [doctorId, start, end]);
  if (res.rows.length === 0) return 15; // Safe baseline fallback if no historical matrix exists yet today
  
  const total = res.rows.reduce((sum, row) => sum + parseFloat(row.duration), 0);
  const avg = total / res.rows.length;
  return avg > 2 ? Math.round(avg) : 5; // Enforce a logical 5-minute minimum ceiling per consult
}

// --- DYNAMIC INFRASTRUCTURE LOOKUPS WITH REAL-TIME ETA ENHANCEMENT ---
app.get('/api/metadata/facilities', async (req, res) => {
  try {
    const depts = await pool.query('SELECT id, name, code FROM departments ORDER BY name ASC');
    const docsRes = await pool.query('SELECT id, name, department_id, room_number FROM doctors WHERE is_available = true');
    
    const { start, end } = getOperationalWindow();
    const doctorsWithEta = [];
    
    for (let doc of docsRes.rows) {
      const avgSpeed = await getDoctorAverageSpeed(doc.id, start, end);
      doctorsWithEta.push({ ...doc, average_speed: avgSpeed });
    }

    res.json({ departments: depts.rows, doctors: doctorsWithEta });
  } catch (err) { res.status(500).send("Metadata retrieval error"); }
});

// --- AUTHENTICATION ---
app.post('/api/auth/signup', async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, email, password, role, departmentId, roomNumber } = req.body;
    await client.query('BEGIN');

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userResult = await client.query(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role`,
      [username, email, passwordHash, role]
    );
    const newUser = userResult.rows[0];

    if (role === 'DOCTOR') {
      if (!departmentId || !roomNumber) throw new Error("Doctor metadata required.");
      await client.query(
        `INSERT INTO doctors (name, department_id, is_available, room_number, user_id) VALUES ($1, $2, true, $3, $4)`,
        [username, parseInt(departmentId, 10), roomNumber, newUser.id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ message: "User registered", user: newUser });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: "Registration fault", details: err.message });
  } finally { client.release(); }
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
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, doctorInfo: doctorContext } });
  } catch (err) { res.status(500).send("Login server error"); }
});

// --- OPTIMIZED MULTI-STOP ENGINE WITH COLLISION FILTERS ---
app.post('/api/itinerary/create-multi', async (req, res) => {
  const client = await pool.connect();
  try {
    const { patientId, appointments } = req.body;
    if (!appointments || appointments.length === 0) return res.status(400).send("No locations selected.");

    await client.query('BEGIN');
    const { start, end } = getOperationalWindow();

    const conflictCheck = await client.query(
      `SELECT COUNT(*) FROM itinerary_steps 
       WHERE itinerary_id IN (SELECT id FROM patient_itineraries WHERE patient_id = $1 AND created_at >= $2 AND created_at < $3)
         AND status != 'COMPLETED'`,
      [patientId, start, end]
    );
    if (parseInt(conflictCheck.rows[0].count, 10) > 0) {
      throw new Error("Patient already has active itineraries running in this 24-hour block.");
    }

    const parentItin = await client.query(`INSERT INTO patient_itineraries (patient_id) VALUES ($1) RETURNING id`, [patientId]);
    const itineraryId = parentItin.rows[0].id;
    const tokenNumber = `CF-${Math.floor(1000 + Math.random() * 9000)}`;

    const loadedDepts = [];
    for (let appt of appointments) {
      const loadRes = await client.query(
        `SELECT COUNT(*) FROM itinerary_steps WHERE department_id = $1 AND status = 'WAITING' AND created_at >= $2 AND created_at < $3`,
        [appt.departmentId, start, end]
      );
      loadedDepts.push({ ...appt, count: parseInt(loadRes.rows[0].count, 10) });
    }
    loadedDepts.sort((a, b) => a.count - b.count);

    for (let i = 0; i < loadedDepts.length; i++) {
      const initialStatus = (i === 0) ? 'WAITING' : 'PENDING';
      await client.query(
        `INSERT INTO itinerary_steps (itinerary_id, department_id, doctor_id, step_sequence, priority, token_number, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [itineraryId, loadedDepts[i].departmentId, loadedDepts[i].doctorId, i + 1, 'MEDIUM', tokenNumber, initialStatus]
      );
    }

    await client.query('COMMIT');

    const primaryDept = loadedDepts[0].departmentId;
    const freshQueue = await getCleanQueue(primaryDept);
    io.to(`dept_${primaryDept}`).emit('queue_updated', { departmentId: primaryDept, queue: freshQueue });

    res.json({ message: "Optimized journey compiled!", token: tokenNumber });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// --- DATA ACCESS OVERLAYS ---
app.get('/api/doctor/queue/:doctorId', async (req, res) => {
  try {
    const { start, end } = getOperationalWindow();
    const result = await pool.query(
      `SELECT id, token_number, status, priority, itinerary_id, step_sequence, department_id 
       FROM itinerary_steps WHERE doctor_id = $1 AND status IN ('WAITING', 'CALLED', 'IN_CONSULTATION') AND created_at >= $2 AND created_at < $3
       ORDER BY CASE priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 END ASC, created_at ASC`,
      [req.params.doctorId, start, end]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/itinerary/patient/:patientId', async (req, res) => {
  try {
    const { start, end } = getOperationalWindow();
    const result = await pool.query(
      `SELECT s.token_number, d.name as department_name, doc.name as doctor_name, s.status, s.step_sequence, s.priority, doc.room_number
       FROM itinerary_steps s 
       JOIN departments d ON s.department_id = d.id 
       JOIN doctors doc ON s.doctor_id = doc.id 
       JOIN patient_itineraries i ON s.itinerary_id = i.id
       WHERE i.patient_id = $1 AND s.created_at >= $2 AND s.created_at < $3 
       ORDER BY s.step_sequence ASC`,
      [req.params.patientId, start, end]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/queue/:deptId', async (req, res) => {
  try { const data = await getCleanQueue(req.params.deptId); res.json(data); } 
  catch (err) { res.status(500).send(err.message); }
});

// --- DISPATCH ACTIONS ---
app.patch('/api/queue/next', async (req, res) => {
  try {
    const { doctorId, departmentId } = req.body;
    const { start, end } = getOperationalWindow();
    
    const findNextPatientQuery = `
      SELECT s.id, s.itinerary_id, i.patient_id, s.token_number, doc.name as doc_name, doc.room_number
      FROM itinerary_steps s JOIN patient_itineraries i ON s.itinerary_id = i.id JOIN doctors doc ON s.doctor_id = doc.id
      WHERE s.doctor_id = $1 AND s.department_id = $2 AND s.status = 'WAITING' AND s.created_at >= $3 AND s.created_at < $4
      ORDER BY CASE s.priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 END ASC, s.created_at ASC LIMIT 1;
    `;
    const nextPatientResult = await pool.query(findNextPatientQuery, [doctorId, departmentId, start, end]);
    if (nextPatientResult.rows.length === 0) return res.json({ message: "Queue Clear." });
    
    const currentStep = nextPatientResult.rows[0];
    await pool.query(`UPDATE itinerary_steps SET status = 'CALLED', called_at = CURRENT_TIMESTAMP WHERE id = $1`, [currentStep.id]);
    
    const freshQueueData = await getCleanQueue(departmentId);
    io.to(`dept_${departmentId}`).emit('queue_updated', { departmentId, queue: freshQueueData });
    
    io.to(`user_${currentStep.patient_id}`).emit('appointment_called_alert', {
      token: currentStep.token_number, 
      message: `🚨 Token ${currentStep.token_number} called! Proceed to ${currentStep.doc_name} in Room${currentStep.room_number}.`
    });
    
    io.emit('patient_movement_trigger', { itineraryId: currentStep.itinerary_id });
    res.json({ message: "Success" });
  } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/queue/complete', async (req, res) => {
  try {
    const { stepId, itineraryId, departmentId } = req.body;
    await pool.query(`UPDATE itinerary_steps SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [stepId]);

    const currentStepRes = await pool.query(`SELECT step_sequence FROM itinerary_steps WHERE id = $1`, [stepId]);
    const nextSeq = currentStepRes.rows[0].step_sequence + 1;

    const nextStepRes = await pool.query(
      `SELECT id, department_id FROM itinerary_steps WHERE itinerary_id = $1 AND step_sequence = $2 AND status = 'PENDING'`,
      [itineraryId, nextSeq]
    );

    if (nextStepRes.rows.length > 0) {
      const nextStep = nextStepRes.rows[0];
      await pool.query(`UPDATE itinerary_steps SET status = 'WAITING' WHERE id = $1`, [nextStep.id]);
      const nextDeptQueue = await getCleanQueue(nextStep.department_id);
      io.to(`dept_${nextStep.department_id}`).emit('queue_updated', { departmentId: nextStep.department_id, queue: nextDeptQueue });
    }

    const cleanCurrentDept = await getCleanQueue(departmentId);
    io.to(`dept_${departmentId}`).emit('queue_updated', { departmentId, queue: cleanCurrentDept });
    
    io.emit('patient_movement_trigger', { itineraryId });
    res.json({ message: "Journey progressed." });
  } catch (err) { res.status(500).send(err.message); }
});

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => { console.log(`CURAFLOW Central Network Hub deployed on port ${PORT}`); });