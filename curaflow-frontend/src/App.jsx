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
  
  // Auth profiles
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userRole, setUserRole] = useState('PATIENT');
  
  const [systemDepts, setSystemDepts] = useState([]);
  const [systemDocs, setSystemDocs] = useState([]);
  const [activeNotification, setActiveNotification] = useState(null);

  // Workflow path parameters
  const [tvSelectedDept, setTvSelectedDept] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('');
  const [appointmentCart, setAppointmentCart] = useState([]); 
  const [patientItinerary, setPatientItinerary] = useState([]);

  const loadMetadata = () => {
    fetch(`${BACKEND_URL}/api/metadata/facilities`)
      .then(res => res.json())
      .then(data => {
        setSystemDepts(data.departments);
        setSystemDocs(data.doctors);
        if (data.departments.length > 0) {
          setTvSelectedDept(data.departments[0].id);
          setSelectedDeptId(data.departments[0].id);
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

  useEffect(() => { loadMetadata(); }, []);

  useEffect(() => {
    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));
    
    socket.on("queue_updated", (data) => {
      if (activeView === 'monitor' && Number(data.departmentId) === Number(tvSelectedDept)) {
        setQueue(data.queue);
      }
    });
    
    socket.on("appointment_called_alert", (data) => {
      setActiveNotification(data.message);
      if (window.alert) window.alert(data.message);
    });
    
    socket.on("patient_movement_trigger", () => {
      loadMetadata(); // Dynamic velocity metrics recalculation refresh toggle hook
      if (user && user.role === 'PATIENT') fetchPatientItinerary(user.id);
      if (user && user.role === 'DOCTOR') fetchDoctorQueue(user.doctorInfo.id);
    });

    return () => {
      socket.off("connect"); socket.off("disconnect");
      socket.off("queue_updated"); socket.off("appointment_called_alert");
      socket.off("patient_movement_trigger");
    };
  }, [activeView, tvSelectedDept, user]);

  useEffect(() => {
    if (user) socket.emit('register_user_notification_channel', user.id);
  }, [user]);

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
        departmentId: selectedDeptId, 
        roomNumber: username.toUpperCase() + "_RM" + Math.floor(100 + Math.random() * 900)
      };
    }

    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || data.details || "Auth execution failed.");
      
      if (authMode === 'signup') {
        setAuthMode('login');
        return alert("Registration successful.");
      }

      setUser(data.user);
      setActiveView(data.user.role === 'PATIENT' ? 'patient' : 'doctor');
    } catch (err) { console.error(err); }
  };

  const handleLogout = () => {
    setUser(null);
    setPatientItinerary([]);
    setAppointmentCart([]);
    setEmail('');
    setPassword('');
    setUsername('');
    setActiveNotification(null);
    setActiveView('patient'); 
  };

  const addToCart = () => {
    if (!selectedDeptId || !selectedDocId) return alert("Select department and doctor fields.");
    const dept = systemDepts.find(d => Number(d.id) === Number(selectedDeptId));
    const doc = systemDocs.find(d => Number(d.id) === Number(selectedDocId));
    
    if (appointmentCart.some(item => item.departmentId === dept.id)) {
      return alert("You have already added this department to your journey.");
    }
    setAppointmentCart([...appointmentCart, { departmentId: dept.id, departmentName: dept.name, doctorId: doc.id, doctorName: doc.name }]);
  };

  const dispatchMultiItinerary = async (e) => {
    e.preventDefault();
    if (appointmentCart.length === 0) return alert("Your routing basket is empty.");
    try {
      const res = await fetch(`${BACKEND_URL}/api/itinerary/create-multi`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: user.id, appointments: appointmentCart })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Journey orchestration conflict trace.");
      alert(`Journey created! Token: ${data.token}`);
      setAppointmentCart([]);
      fetchPatientItinerary(user.id);
    } catch(err) { console.error(err); }
  };

  const handleCallNext = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/queue/next`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId: user.doctorInfo.id, departmentId: user.doctorInfo.department_id }),
      });
      fetchDoctorQueue(user.doctorInfo.id);
    } catch (err) { console.error(err); }
  };

  const handleCompleteStep = async (stepId, itineraryId) => {
    try {
      await fetch(`${BACKEND_URL}/api/queue/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
          
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#0b0e14', padding: '4px 12px', borderRadius: '6px', border: '1px solid #1f293d' }}>
              <span style={{ fontSize: '0.75rem', color: '#8a99ad' }}>
                ID: <strong style={{ color: '#fff' }}>{user.username.toUpperCase()}</strong> ({user.role})
              </span>
              <button onClick={handleLogout} style={{ background: 'transparent', border: 'none', color: '#ff7675', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold', padding: '0 0 0 8px', borderLeft: '1px solid #1f293d' }}>
                [LOGOUT]
              </button>
            </div>
          )}

          <span style={{ padding: '2px 8px', borderRadius: '4px', border: `1px solid ${isConnected ? '#2ecc71' : '#e74c3c'}`, color: isConnected ? '#2ecc71' : '#e74c3c', fontSize: '0.75rem' }}>
            {isConnected ? "● NET_OK" : "▲ NET_ERR"}
          </span>
          
          <div style={{ background: '#0b0e14', padding: '3px', borderRadius: '6px', display: 'flex', border: '1px solid #1f293d' }}>
            {['monitor', 'doctor', 'patient'].map((v) => (
              <button key={v} onClick={() => setActiveView(v)} style={{ padding: '6px 14px', background: activeView === v ? '#1f293d' : 'transparent', color: activeView === v ? '#00ced1' : '#576574', border: 'none', cursor: 'pointer', fontSize: '0.75rem' }}>
                {v === 'monitor' ? 'DEPT_TV' : v === 'doctor' ? 'CTRL_STATION' : 'USER_PORTAL'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeNotification && (
        <div style={{ background: '#2d1418', color: '#ff7675', borderBottom: '1px solid #e74c3c', padding: '14px 40px', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{activeNotification}</span>
          <button onClick={() => setActiveNotification(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>[DISMISS]</button>
        </div>
      )}

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '40px' }}>
        
        {/* VIEW 1: DYNAMIC MONITORS WITH INTELLIGENT REAL-TIME ETA OVERLAYS */}
        {activeView === 'monitor' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1f293d', paddingBottom: '15px', marginBottom: '35px' }}>
              <h2>[DEPT_LIVE_SCREEN_MATRIX]</h2>
              <select value={tvSelectedDept} onChange={e => setTvSelectedDept(Number(e.target.value))} style={{ background: '#111622', color: '#00ced1', border: '1px solid #1f293d', padding: '6px', fontFamily: 'monospace', cursor: 'pointer' }}>
                {systemDepts.map(d => <option key={d.id} value={d.id}>{d.name.toUpperCase()}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
              {systemDocs.filter(d => Number(d.department_id) === Number(tvSelectedDept)).map(doc => {
                const docQueue = queue.filter(p => Number(p.doctor_id) === Number(doc.id));
                // ENHANCED MATRIX CALCULATOR: Uses actual historical average shift speeds rather than hardcoded metrics
                const dynamicWaitTime = docQueue.filter(p => p.status === 'WAITING').length * (doc.average_speed || 15);
                
                return (
                  <div key={doc.id} style={{ background: '#111622', border: '1px solid #1f293d', borderRadius: '8px', padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed #1f293d', paddingBottom: '12px', marginBottom: '20px' }}>
                      <h3 style={{ margin: 0, color: '#fff' }}>👩‍⚕️ {doc.name.toUpperCase()} (Room {doc.room_number})</h3>
                      <div style={{ display: 'flex', gap: '20px', fontSize: '0.8rem' }}>
                        <span style={{ color: '#8a99ad' }}>⚡ SPEED: {doc.average_speed || 15} MIN/PATIENT</span>
                        <span style={{ color: '#00ced1', fontWeight: 'bold' }}>EST_WAIT: ~{dynamicWaitTime} MINS</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '15px' }}>
                      {docQueue.length === 0 ? <p style={{ color: '#4b5563', margin: 0, fontSize: '0.8rem' }}>NO ACTIVE TICKETS ENQUEUED.</p> : 
                        docQueue.map(p => (
                          <div key={p.id} style={{ background: p.status === 'CALLED' ? '#12252e' : '#0b0e14', border: p.status === 'CALLED' ? '1px solid #00ced1' : '1px solid #1f293d', padding: '20px', borderRadius: '6px', animation: p.status === 'CALLED' ? 'pulse-border 2s infinite ease-in-out' : 'none' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginBottom: '8px' }}>
                              <span style={{ color: p.status === 'CALLED' ? '#00ced1' : '#576574' }}>{p.status === 'CALLED' ? '◀ PROCEED TO ROOM' : '📟 WAITING'}</span>
                              <span style={{ background: '#1f293d', color: '#fff', padding: '1px 5px' }}>{p.status}</span>
                            </div>
                            <h4 style={{ margin: 0, fontSize: '1.8rem', color: '#fff', textAlign: 'center' }}>{p.token_number}</h4>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 2: ISOLATED DOCTOR CONSOLE */}
        {activeView === 'doctor' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {!user || user.role !== 'DOCTOR' ? <p style={{ color: '#576574' }}>ACCESS PROHIBITED. LOG INTO USER_PORTAL CONSOLE AS A DOCTOR.</p> : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', marginBottom: '30px' }}>
                  <div style={{ background: '#111622', padding: '24px', borderRadius: '8px', border: '1px solid #1f293d' }}>
                    <h2>{user.doctorInfo?.name.toUpperCase()} // Room {user.doctorInfo?.room_number}</h2>
                    <span style={{ color: '#00ced1', fontSize: '0.75rem' }}>ISOLATED CLINIC QUEUE ENGINE RUNNING</span>
                  </div>
                  <button onClick={handleCallNext} style={{ background: '#1f293d', color: '#00ced1', border: '1px solid #00ced1', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>⚡ DISPATCH NEXT REQ</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {queue.length === 0 ? <p style={{ color: '#4b5563' }}>NO WAITING APPOINTMENTS ASSIGNED TO YOUR WORKSPACE TODAY.</p> :
                    queue.map((p) => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#111622', padding: '14px 20px', borderRadius: '6px', border: '1px solid #1f293d' }}>
                        <span style={{ fontSize: '1.1rem', color: '#fff', fontWeight: 'bold' }}>&gt; {p.token_number}</span>
                        <div>
                          {p.status === 'CALLED' && (
                            <button onClick={() => handleCompleteStep(p.id, p.itinerary_id)} style={{ padding: '6px 12px', background: '#2ecc71', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px', marginRight: '10px' }}>✓ DISCHARGE & ROUTE NEXT</button>
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

        {/* VIEW 3: USER PORTAL GATEWAY */}
        {activeView === 'patient' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
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
                          <select value={selectedDeptId} onChange={e => setSelectedDeptId(e.target.value)} style={{ background: '#0b0e14', color: '#fff', padding: '8px', border: '1px solid #1f293d', borderRadius: '4px', fontFamily: 'monospace' }} required>
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
                
                {/* Left Component: Cart */}
                <div style={{ background: '#111622', padding: '30px', borderRadius: '12px', border: '1px solid #1f293d' }}>
                  <div style={{ fontSize: '0.75rem', color: '#576574' }}>SESSION ACTIVE // {user.role}</div>
                  <h3 style={{ margin: '5px 0 25px 0', color: '#fff' }}>IDENTITY: {user.username.toUpperCase()}</h3>
                  
                  {user.role === 'PATIENT' ? (
                    <div>
                      <h4>[COMPILE COMPREHENSIVE PATH JOURNEY]</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
                        <select value={selectedDeptId} onChange={e => { setSelectedDeptId(e.target.value); setSelectedDocId(''); }} style={{ background: '#0b0e14', color: '#fff', padding: '10px', border: '1px solid #1f293d' }}>
                          <option value="">-- SELECT CLINIC WARD --</option>
                          {systemDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>

                        <select value={selectedDocId} onChange={e => setSelectedDocId(e.target.value)} style={{ background: '#0b0e14', color: '#fff', padding: '10px', border: '1px solid #1f293d' }} required>
                          <option value="">-- SELECT SPECIALIST TARGET --</option>
                          {systemDocs.filter(d => Number(d.department_id) === Number(selectedDeptId)).map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                        </select>

                        <button type="button" onClick={addToCart} style={{ padding: '10px', background: '#1f293d', color: '#00ced1', border: '1px solid #00ced1', cursor: 'pointer', fontWeight: 'bold' }}>+ ADD VISIT TO JOURNEY</button>
                      </div>

                      {appointmentCart.length > 0 && (
                        <div style={{ marginTop: '25px', padding: '15px', background: '#0b0e14', border: '1px dashed #1f293d' }}>
                          <span style={{ fontSize: '0.8rem', color: '#00ced1' }}>ROUTE PROGRESS SEQUENCE:</span>
                          {appointmentCart.map((item, index) => <div key={index} style={{ fontSize: '0.85rem', color: '#fff', marginTop: '6px' }}>Stop {index+1}: {item.departmentName} ({item.doctorName})</div>)}
                          <button onClick={dispatchMultiItinerary} style={{ width: '100%', marginTop: '15px', padding: '12px', background: '#2ecc71', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>✓ BOOK OPTIMIZED JOURNEY</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ color: '#576574', fontSize: '0.85rem' }}>Logged in as Doctor operator. Use the upper navigation tabs to access your controller panels.</p>
                  )}
                  <button onClick={handleLogout} style={{ width: '100%', marginTop: '20px', padding: '10px', background: '#1c1f26', color: '#ff7675', border: 'none', cursor: 'pointer', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold' }}>TERMINATE SESSION [LOGOUT]</button>
                </div>

                {/* Right Component: Live Progress Metrics Tracker */}
                <div style={{ background: '#111622', padding: '30px', borderRadius: '12px', border: '1px solid #1f293d' }}>
                  <div style={{ borderBottom: '1px solid #1f293d', paddingBottom: '15px', marginBottom: '20px', fontSize: '0.85rem', color: '#fff' }}>[DAILY_CLINICAL_ITINERARY_TRACKER]</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {patientItinerary.length === 0 ? <p style={{ color: '#4b5563', fontSize: '0.85rem' }}>NO ENQUEUED WORKFLOW RECORDS ENCOUNTERED TODAY.</p> :
                      patientItinerary.map((step, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', background: '#0b0e14', padding: '14px', borderRadius: '6px', border: step.status === 'CALLED' ? '1px solid #00ced1' : '1px solid #1f293d', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ color: '#fff', fontWeight: 'bold' }}>{step.step_sequence}. {step.department_name}</div>
                            <div style={{ color: '#00ced1', fontSize: '0.75rem' }}>Doctor Ref: {step.doctor_name} (Room {step.room_number})</div>
                          </div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: step.status === 'COMPLETED' ? '#2ecc71' : step.status === 'CALLED' ? '#00ced1' : step.status === 'WAITING' ? '#f39c12' : '#4b5563' }}>{step.status}</span>
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