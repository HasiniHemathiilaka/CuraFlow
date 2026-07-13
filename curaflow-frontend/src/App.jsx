import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const BACKEND_URL = "http://127.0.0.1:5000";
const socket = io(BACKEND_URL);

if (typeof window !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes pulse-border {
      0% { border-color: rgba(0, 206, 209, 0.2); box-shadow: 0 0 0 0 rgba(0, 206, 209, 0.2); }
      50% { border-color: rgba(0, 206, 209, 0.8); box-shadow: 0 0 15px 2px rgba(0, 206, 209, 0.15); }
      100% { border-color: rgba(0, 206, 209, 0.2); box-shadow: 0 0 0 0 rgba(0, 206, 209, 0.2); }
    }
  `;
  document.head.appendChild(style);
}

function App() {
  const [queue, setQueue] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeView, setActiveView] = useState('monitor'); 
  
  // Auth & System Profiles Metadata
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userRole, setUserRole] = useState('PATIENT');
  
  const [systemDepts, setSystemDepts] = useState([]);
  const [systemDocs, setSystemDocs] = useState([]);

  // Selection configurations
  const [tvSelectedDept, setTvSelectedDept] = useState('');
  const [bookingDept, setBookingDept] = useState('');
  const [bookingDoc, setBookingDoc] = useState('');
  const [bookingPriority, setBookingPriority] = useState('MEDIUM');
  const [patientItinerary, setPatientItinerary] = useState([]);

  const loadMetadata = () => {
    fetch(`${BACKEND_URL}/api/metadata/facilities`)
      .then(res => res.json())
      .then(data => {
        setSystemDepts(data.departments);
        setSystemDocs(data.doctors);
        
        // Safety lock: Only set initial state defaults if not already populated
        if (data.departments.length > 0) {
          setBookingDept(prev => prev || data.departments[0].id);
          setTvSelectedDept(prev => prev || data.departments[0].id);
        }
      }).catch(err => console.error(err));
  };

  const fetchTvQueue = (deptId) => {
    if(!deptId) return;
    fetch(`${BACKEND_URL}/api/queue/${deptId}`)
      .then(res => res.json())
      .then(data => setQueue(Array.isArray(data) ? data : []))
      .catch(err => console.error(err));
  };

  const fetchDoctorQueue = (docId) => {
    fetch(`${BACKEND_URL}/api/doctor/queue/${docId}`)
      .then(res => res.json())
      .then(data => setQueue(Array.isArray(data) ? data : []))
      .catch(err => console.error(err));
  };

  const fetchPatientItinerary = (id) => {
    fetch(`${BACKEND_URL}/api/itinerary/patient/${id}`)
      .then(res => res.json())
      .then(data => setPatientItinerary(data))
      .catch(err => console.error(err));
  };

  // LOOP A: Enforce database configurations download EXACTLY once on mount
  useEffect(() => {
    loadMetadata();
  }, []);

  // LOOP B: Manage continuous real-time system network events 
  useEffect(() => {
    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    socket.on("queue_updated", (data) => {
      if (activeView === 'monitor' && Number(data.departmentId) === Number(tvSelectedDept)) {
        setQueue(data.queue);
      }
    });

    socket.on("patient_movement_trigger", () => {
      if (user && user.role === 'PATIENT') fetchPatientItinerary(user.id);
      if (user && user.role === 'DOCTOR') fetchDoctorQueue(user.doctorInfo.id);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("queue_updated");
      socket.off("patient_movement_trigger");
    };
  }, [activeView, tvSelectedDept, user]);

  // LOOP C: Room adjustments on view changes
  useEffect(() => {
    if (activeView === 'monitor' && tvSelectedDept) {
      socket.emit('join_department_room', tvSelectedDept);
      fetchTvQueue(tvSelectedDept);
    } else if (activeView === 'doctor' && user?.doctorInfo) {
      fetchDoctorQueue(user.doctorInfo.id);
    }
  }, [activeView, tvSelectedDept, user]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
    
    let payload = { email, password };
    if (authMode === 'signup') {
      payload = { 
        username, email, password, role: userRole,
        departmentId: bookingDept, 
        roomNumber: username.toUpperCase() + "_RM" + Math.floor(100 + Math.random() * 900)
      };
    }

    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || data.details || "Auth execution failed.");
      
      if (authMode === 'signup') {
        setAuthMode('login');
        return alert("Registration complete. Initialize sign in phase.");
      }

      setUser(data.user);
      setActiveView(data.user.role === 'PATIENT' ? 'patient' : 'doctor');
    } catch (err) { console.error(err); }
  };

  const handleBookAppointment = async (e) => {
    e.preventDefault();
    if(!bookingDoc) return alert("Select a practitioner target.");
    try {
      await fetch(`${BACKEND_URL}/api/itinerary/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: user.id, departmentId: bookingDept, doctorId: bookingDoc, priority: bookingPriority })
      });
      alert("Appointment queued successfully.");
      fetchPatientItinerary(user.id);
    } catch(err) { console.error(err); }
  };

  const handleCallNext = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/queue/next`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId: user.doctorInfo.id, departmentId: user.doctorInfo.department_id }),
      });
      fetchDoctorQueue(user.doctorInfo.id);
    } catch (err) { console.error(err); }
  };

  const handleCompleteStep = async (stepId, itineraryId) => {
    try {
      await fetch(`${BACKEND_URL}/api/queue/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId, itineraryId, departmentId: user.doctorInfo.department_id }),
      });
      fetchDoctorQueue(user.doctorInfo.id);
    } catch (err) { console.error(err); }
  };

  const getPriorityStyle = (priority) => {
    switch(priority) {
      case 'EMERGENCY': return { bg: '#2d1418', border: '#e74c3c', text: '#ff7675' };
      case 'HIGH': return { bg: '#2d2214', border: '#e67e22', text: '#f39c12' };
      case 'MEDIUM': return { bg: '#14202d', border: '#3498db', text: '#74b9ff' };
      default: return { bg: '#1c1f26', border: '#4b5563', text: '#9ca3af' };
    }
  };

  return (
    <div style={{ background: '#0b0e14', color: '#d1d5db', minHeight: '100vh', fontFamily: 'monospace', padding: '0 0 40px 0' }}>
      
      {/* Telemetry Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111622', padding: '16px 40px', borderBottom: '1px solid #1f293d' }}>
        <h1 style={{ fontSize: '1.1rem', color: '#fff', margin: 0, letterSpacing: '1px' }}>SYS.CURAFLOW // V4.0</h1>
        <div style={{ display: 'flex', gap: '25px', alignItems: 'center' }}>
          <span style={{ padding: '2px 8px', borderRadius: '4px', border: `1px solid ${isConnected ? '#2ecc71' : '#e74c3c'}`, color: isConnected ? '#2ecc71' : '#e74c3c', fontSize: '0.75rem' }}>
            {isConnected ? "● NET_OK" : "▲ NET_ERR"}
          </span>
          <div style={{ background: '#0b0e14', padding: '3px', borderRadius: '6px', display: 'flex', border: '1px solid #1f293d' }}>
            {['monitor', 'doctor', 'patient'].map((v) => (
              <button key={v} onClick={() => setActiveView(v)} style={{ padding: '6px 14px', background: activeView === v ? '#1f293d' : 'transparent', color: activeView === v ? '#00ced1' : '#576574', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                {v === 'monitor' ? 'DEPT_TV' : v === 'doctor' ? 'CTRL_STATION' : 'USER_PORTAL'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '40px' }}>
        
        {/* VIEW 1: DYNAMIC ISOLATED DEPARTMENT SIGNAGE MOUNT */}
        {activeView === 'monitor' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1f293d', paddingBottom: '15px', marginBottom: '30px' }}>
              <h2 style={{ fontSize: '1rem', margin: 0 }}>[DEPT_LIVE_SCREEN_MATRIX]</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.75rem', color: '#576574' }}>SELECT ACTIVE WARD TV HARDWARE VIEW:</span>
                <select 
                  value={tvSelectedDept} 
                  onChange={e => {
                    const nextId = Number(e.target.value);
                    setTvSelectedDept(nextId);
                    setBookingDept(nextId); 
                  }} 
                  style={{ background: '#111622', color: '#00ced1', border: '1px solid #1f293d', padding: '6px', borderRadius: '4px', fontFamily: 'monospace', cursor: 'pointer' }}
                >
                  {systemDepts.map(d => <option key={d.id} value={d.id}>{d.name.toUpperCase()} [{d.code}]</option>)}
                </select>
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
              {queue.length === 0 ? <p style={{ color: '#4b5563' }}>NO ACTIVE TICKET SLICES GENERATED OUTSIDE THIS CLINIC SEGMENT.</p> : 
                queue.map((p) => (
                  <div key={p.id} style={{ background: p.status === 'CALLED' ? '#12252e' : '#111622', border: p.status === 'CALLED' ? '1px solid #00ced1' : '1px solid #1f293d', padding: '30px 24px', borderRadius: '8px', animation: p.status === 'CALLED' ? 'pulse-border 2s infinite ease-in-out' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '0.7rem' }}>
                      <span style={{ color: p.status === 'CALLED' ? '#00ced1' : '#576574' }}>{p.status === 'CALLED' ? '◀ DISPATCH ACTIVE' : '📟 ENQUEUED'}</span>
                      <span style={{ color: '#fff', background: '#1f293d', padding: '2px 6px' }}>{p.status}</span>
                    </div>
                    <h3 style={{ fontSize: '2.5rem', margin: 0, color: '#fff' }}>{p.token_number}</h3>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* VIEW 2: ISOLATED DOCTOR TREATMENT CONSOLE */}
        {activeView === 'doctor' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {!user || user.role !== 'DOCTOR' ? <p style={{ color: '#576574' }}>ACCESS PROHIBITED. DOCK INTO SECURE USER_PORTAL CONSOLE AS A DOCTOR TO ACQUIRE WORKSPACE CONTEXT.</p> : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', marginBottom: '30px' }}>
                  <div style={{ background: '#111622', padding: '24px', borderRadius: '8px', border: '1px solid #1f293d' }}>
                    <div style={{ fontSize: '0.7rem', color: '#576574' }}>OPERATOR CONTEXT PROFILE INJECTED</div>
                    <h2 style={{ fontSize: '1.2rem', margin: '5px 0', color: '#fff' }}>{user.doctorInfo?.name.toUpperCase()} // Room {user.doctorInfo?.room_number}</h2>
                    <div style={{ fontSize: '0.75rem', color: '#00ced1' }}>ISOLATED WORKSPACE DEPLOYMENT QUEUE</div>
                  </div>
                  <button onClick={handleCallNext} style={{ background: '#1f293d', color: '#00ced1', border: '1px solid #00ced1', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>⚡ DISPATCH NEXT REQ</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {queue.length === 0 ? <p style={{ color: '#4b5563' }}>NO WAITING APPOINTMENTS ASSIGNED TO YOUR OPERATOR ID TODAY.</p> :
                    queue.map((p) => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#111622', padding: '14px 20px', borderRadius: '6px', border: '1px solid #1f293d' }}>
                        <span style={{ fontSize: '1.1rem', color: '#fff', fontWeight: 'bold' }}>&gt; {p.token_number}</span>
                        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                          <span style={{ background: getPriorityStyle(p.priority).bg, color: getPriorityStyle(p.priority).text, border: `1px solid ${getPriorityStyle(p.priority).border}`, padding: '3px 8px', fontSize: '0.7rem' }}>{p.priority}</span>
                          {p.status === 'CALLED' && (
                            <button onClick={() => handleCompleteStep(p.id, p.itinerary_id)} style={{ padding: '6px 12px', background: '#2ecc71', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>✓ COMPLETE VISIT</button>
                          )}
                          <span style={{ fontSize: '0.8rem', color: '#576574' }}>{p.status}</span>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: INTEGRATED DUAL GATEWAY LOGINS & DISCRETE APPOINTMENT ENGINE */}
        {activeView === 'patient' && (
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {!user ? (
              <div style={{ maxWidth: '450px', margin: '0 auto', background: '#111622', padding: '35px', borderRadius: '12px', border: '1px solid #1f293d' }}>
                <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '25px', borderBottom: '1px solid #1f293d', paddingBottom: '10px' }}>
                  <button onClick={() => setAuthMode('login')} style={{ background: 'transparent', border: 'none', color: authMode === 'login' ? '#00ced1' : '#576574', cursor: 'pointer', fontWeight: '700' }}>[01_SIGN_IN]</button>
                  <button onClick={() => setAuthMode('signup')} style={{ background: 'transparent', border: 'none', color: authMode === 'signup' ? '#00ced1' : '#576574', cursor: 'pointer', fontWeight: '700' }}>[02_REGISTRATION]</button>
                </div>
                
                <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {authMode === 'signup' && <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={{ padding: '12px', background: '#0b0e14', border: '1px solid #1f293d', color: '#fff', borderRadius: '6px', fontFamily: 'monospace' }} required />}
                  <input type="email" placeholder="Corporate Identity Email" value={email} onChange={e => setEmail(e.target.value)} style={{ padding: '12px', background: '#0b0e14', border: '1px solid #1f293d', color: '#fff', borderRadius: '6px', fontFamily: 'monospace' }} required />
                  <input type="password" placeholder="Password PIN" value={password} onChange={e => setPassword(e.target.value)} style={{ padding: '12px', background: '#0b0e14', border: '1px solid #1f293d', color: '#fff', borderRadius: '6px', fontFamily: 'monospace' }} required />
                  
                  {authMode === 'signup' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '0.85rem' }}>
                        <span>ROLE SELECTION:</span>
                        <select value={userRole} onChange={e => setUserRole(e.target.value)} style={{ background: '#0b0e14', color: '#00ced1', border: '1px solid #1f293d', padding: '4px', fontFamily: 'monospace' }}>
                          <option value="PATIENT">PATIENT_CLIENT</option>
                          <option value="DOCTOR">DOCTOR_OPERATOR</option>
                        </select>
                      </div>

                      {userRole === 'DOCTOR' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', background: 'rgba(0, 206, 209, 0.03)', border: '1px dashed #1f293d', borderRadius: '6px', fontSize: '0.8rem' }}>
                          <span style={{ color: '#00ced1' }}>[MANDATORY_DOCTOR_ASSIGNMENT_METADATA]</span>
                          <span style={{ marginTop: '5px' }}>SELECT DEPLOYMENT WARD DEPARTMENT:</span>
                          <select value={bookingDept} onChange={e => setBookingDept(e.target.value)} style={{ background: '#0b0e14', color: '#fff', padding: '8px', border: '1px solid #1f293d', borderRadius: '4px', fontFamily: 'monospace' }} required>
                            {systemDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                  <button type="submit" style={{ padding: '12px', background: '#00ced1', color: '#0b0e14', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', textTransform: 'uppercase', fontSize: '0.8rem' }}>EXECUTE SUBMIT REQUEST</button>
                </form>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                
                {/* Left Component: Dynamic Clinic Booking Portal Form */}
                <div style={{ background: '#111622', padding: '30px', borderRadius: '12px', border: '1px solid #1f293d' }}>
                  <div style={{ fontSize: '0.75rem', color: '#576574' }}>SESSION ACTIVE // {user.role}</div>
                  <h3 style={{ margin: '5px 0 25px 0', color: '#fff' }}>IDENTITY: {user.username.toUpperCase()}</h3>
                  
                  {user.role === 'PATIENT' ? (
                    <form onSubmit={handleBookAppointment} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={{ fontSize: '0.85rem', color: '#fff', borderBottom: '1px solid #1f293d', paddingBottom: '6px' }}>[BOOK_CLINICAL_APPOINTMENT]</div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem' }}>
                        <span>SELECT TARGET CLINIC SEGMENT:</span>
                        <select value={bookingDept} onChange={e => { setBookingDept(e.target.value); setBookingDoc(''); }} style={{ background: '#0b0e14', color: '#fff', padding: '10px', border: '1px solid #1f293d', borderRadius: '6px', fontFamily: 'monospace' }}>
                          {systemDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem' }}>
                        <span>ASSIGN MEDICAL PRACTITIONER:</span>
                        <select value={bookingDoc} onChange={e => setBookingDoc(e.target.value)} style={{ background: '#0b0e14', color: '#fff', padding: '10px', border: '1px solid #1f293d', borderRadius: '6px', fontFamily: 'monospace' }} required>
                          <option value="">-- CHOOSE PRACTITIONER --</option>
                          {systemDocs.filter(d => Number(d.department_id) === Number(bookingDept)).map(doc => (
                            <option key={doc.id} value={doc.id}>{doc.name} (Room {doc.room_number})</option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                        <span>TRIAGE SEVERITY:</span>
                        <select value={bookingPriority} onChange={e => setBookingPriority(e.target.value)} style={{ background: '#0b0e14', color: '#fff', padding: '6px', border: '1px solid #1f293d', fontFamily: 'monospace' }}>
                          <option value="LOW">LOW</option>
                          <option value="MEDIUM">MEDIUM</option>
                          <option value="HIGH">HIGH</option>
                          <option value="EMERGENCY">EMERGENCY</option>
                        </select>
                      </div>

                      <button type="submit" style={{ width: '100%', padding: '12px', background: 'rgba(0, 206, 209, 0.1)', color: '#00ced1', border: '1px solid #00ced1', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}>✓ DISPATCH APPOINTMENT RESERVATION</button>
                    </form>
                  ) : (
                    <p style={{ color: '#576574', fontSize: '0.85rem' }}>Logged into workspace under Doctor parameters. Use upper navigation deck toggles to pull your active clinic queue screens.</p>
                  )}
                  <button onClick={() => { setUser(null); setPatientItinerary([]); }} style={{ width: '100%', marginTop: '20px', padding: '10px', background: '#1c1f26', color: '#9ca3af', border: 'none', cursor: 'pointer', borderRadius: '6px', fontSize: '0.8rem' }}>TERMINATE SESSION</button>
                </div>

                {/* Right Component: Live Dynamic Patient Tracking Metrics Dashboard */}
                <div style={{ background: '#111622', padding: '30px', borderRadius: '12px', border: '1px solid #1f293d' }}>
                  <div style={{ borderBottom: '1px solid #1f293d', paddingBottom: '15px', marginBottom: '20px', fontSize: '0.85rem', color: '#fff' }}>[DAILY_CLINICAL_ITINERARY_TRACKER]</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {patientItinerary.length === 0 ? <p style={{ color: '#4b5563', fontSize: '0.85rem' }}>NO ENQUEUED TICKETS OR WORKFLOW RECORDS FOUND TODAY.</p> :
                      patientItinerary.map((step, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '15px', alignItems: 'center', background: '#0b0e14', padding: '14px', borderRadius: '6px', border: step.status === 'CALLED' ? '1px solid #00ced1' : '1px solid #1f293d' }}>
                          <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: step.status === 'COMPLETED' ? '#2ecc71' : step.status === 'CALLED' ? '#00ced1' : '#1f293d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', color: '#0b0e14', fontWeight: 'bold' }}>{step.step_sequence}</div>
                          <div style={{ flex: 1, fontSize: '0.85rem' }}>
                            <div style={{ color: '#fff', fontWeight: 'bold' }}>{step.department_name}</div>
                            <div style={{ color: '#00ced1', fontSize: '0.75rem' }}>Doctor Ref: {step.doctor_name} (Room {step.room_number})</div>
                          </div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: step.status === 'COMPLETED' ? '#2ecc71' : step.status === 'CALLED' ? '#00ced1' : '#4b5563' }}>{step.status}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default App;