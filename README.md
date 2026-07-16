# 📋 CuraFlow v4.0 — Intelligent Outpatient Orchestration Engine

CuraFlow is a real-time, multi-stop hospital outpatient workflow manager designed to eliminate queue collisions and streamline single-day patient journeys. By combining dynamic state tracking, a custom hospital shift model, and private real-time notification channels, it transforms chaotic clinic corridors into predictable, synchronized pipelines.

---

## 🛠️ The Core Tech Stack

*   **Frontend:** React.js (High-contrast obsidian theme, styled reactive views)
*   **Backend:** Node.js, Express.js
*   **Database:** PostgreSQL (Relational time-window logging)
*   **Real-time Layer:** Socket.IO (Event-driven network architecture)
*   **DevOps:** Docker ready for microservice containerization

---

## 💡 Implemented Architecture & Mechanics

### 1. Dynamic Pipeline Routing (State Machine)
To avoid overloading individual waiting rooms, journeys are compiled as a sequence of stops. The primary stop initializes in a visible `WAITING` state, while all subsequent stops are placed in a hidden `PENDING` state. Upon checkout (`COMPLETED`), the engine dynamically triggers a cascade activation, flipping the next step sequence to `WAITING` and broadcasting updates via Socket rooms.

### 2. Rolling 24-Hour Cycle Reset
Operates on a custom hospital shift model (**08:00 AM to 08:00 AM next day**). Queries implicitly filter active patient records via live operational windows rather than using destructive database table deletes, preserving full transactional history for subsequent analytics.

### 3. Targeted Socket Room Networks
WebSocket messaging is carefully sandboxed to avoid global broad-casting bottlenecks:
*   `dept_${departmentId}`: Overhead TV monitor grids selectively join these rooms to capture real-time updates specific to their ward.
*   `user_${userId}`: Logged-in patients register to a private channel to receive direct, precise alerts the instant a practitioner dispatches their token.

### 4. AI-Driven Predictive ETA Engine
Monitors the exact duration between a patient being called (`called_at`) and their checkup finishing (`completed_at`). The system builds an ongoing velocity baseline for individual doctors to dynamically update remaining wait time estimates on the display matrices.

---

## 📂 Repository Structure

```text
├── server.js            # Node.js Express server & Socket.IO network hub
├── App.jsx              # Main React.js single-page dashboard application
├── .env.example         # System environment configurations variable template
└── README.md            # Repository documentation
