const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors'); 
require('dotenv').config();

const app = express();

// 1. Initialize Global Middleware
app.use(cors()); 
app.use(express.json());

// 2. Build the HTTP and WebSocket Servers correctly
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } 
});

// Configure the connection to your PostgreSQL Database
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'CuraFlow',       
  password: '1234', // <-- CHANGE THIS TO YOUR ACTUAL PASSWORD
  port: 5432,
});

// Real-Time WebSocket Connection Event
io.on('connection', (socket) => {
  console.log(`System Alert: A display monitor connected! ID: ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`System Alert: Monitor disconnected.`);
  });
});

// Helper function to fetch the queue (we use this to broadcast fresh data)
async function getCleanQueue(departmentId) {
  const cleanId = parseInt(departmentId, 10); 
  const queryText = `
    SELECT token_number, status, priority, created_at 
    FROM tickets 
    WHERE department_id = $1 AND status IN ('WAITING', 'CALLED', 'IN_CONSULTATION')
    ORDER BY 
      CASE priority 
        WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 
      END ASC, created_at ASC;
  `;
  const result = await pool.query(queryText, [cleanId]);
  return result.rows;
}

// ENDPOINT 1: Fetch the live active queue for the React frontend
app.get('/api/queue/:deptId', async (req, res) => {
  try {
    const data = await getCleanQueue(req.params.deptId);
    res.json(data);
  } catch (err) {
    console.error("Backend Error on Fetch:", err.message);
    res.status(500).send("Server Error fetching queue");
  }
});

// ENDPOINT 2: Doctor calls the next patient (WITH LIVE WEBSOCKET BROADCAST)
app.patch('/api/queue/next', async (req, res) => {
  try {
    const { doctorId, departmentId } = req.body;
    const cleanDeptId = parseInt(departmentId, 10);

    // 1. Find next waiting patient
    const findNextPatientQuery = `
      SELECT id FROM tickets WHERE department_id = $1 AND status = 'WAITING'
      ORDER BY 
        CASE priority WHEN 'EMERGENCY' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 END ASC, 
        created_at ASC LIMIT 1;
    `;
    const nextPatientResult = await pool.query(findNextPatientQuery, [cleanDeptId]);

    if (nextPatientResult.rows.length === 0) {
      return res.json({ message: "No patients currently waiting." });
    }

    const ticketId = nextPatientResult.rows[0].id;

    // 2. Update status to CALLED
    const updateTicketQuery = `
      UPDATE tickets SET status = 'CALLED', doctor_id = $1, called_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING token_number, status;
    `;
    const updatedTicketResult = await pool.query(updateTicketQuery, [doctorId, ticketId]);

    // REAL-TIME BROADCAST: Fetch fresh queue data and blast it out to all screens
    const freshQueueData = await getCleanQueue(cleanDeptId);
    io.emit('queue_updated', { departmentId: cleanDeptId, queue: freshQueueData });

    res.json({
      message: "Next patient called successfully!",
      patient: updatedTicketResult.rows[0]
    });

  } catch (err) {
    console.error("Backend Error on Shift:", err.message);
    res.status(500).send("Server Error shifting queue");
  }
});

// Start listening using the HTTP server layer variable
const PORT = 5000;
server.listen(PORT, () => {
  console.log(`CURA FLOW Real-Time engine live on http://localhost:${PORT}`);
});