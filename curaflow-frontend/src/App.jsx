import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const BACKEND_URL = "http://127.0.0.1:5000";
const socket = io(BACKEND_URL);

// Injection of ultra-high contrast dark mode tokens, readable typography, and bright action layouts
if (typeof window !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@600&display=swap');
    
    :root {
      --bg-main: #060913;      /* Deep obsidian background for zero glare */
      --bg-card: #0f1524;      /* High contrast distinct card background */
      --border-color: rgba(255, 255, 255, 0.12); /* Crisp, visible layout frames */
      --text-main: #ffffff;    /* Absolute white for primary typography */
      --text-muted: #94a3b8;   /* Clean silver-slate for minor context labels */
      --primary: #00f2fe;      /* Ultra-bright neon cyan accent */
      --primary-glow: rgba(0, 242, 254, 0.2);
      --success: #10b981;      /* Vivid emerald green */
      --success-glow: rgba(16, 185, 129, 0.15);
      --error: #f43f5e;
      --warning: #fbbf24;
    }

    * {
      box-sizing: border-box;
      transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    }

    body {
      margin: 0;
      background-color: var(--bg-main);
      color: var(--text-main);
      -webkit-font-smoothing: antialiased;
    }

    @keyframes card-pulse-neon {
      0% { border-color: rgba(0, 242, 254, 0.4); box-shadow: 0 0 0 0 rgba(0, 242, 254, 0.2); }
      50% { border-color: rgba(0, 242, 254, 1); box-shadow: 0 0 25px 4px rgba(0, 242, 254, 0.35); }
      100% { border-color: rgba(0, 242, 254, 0.4); box-shadow: 0 0 0 0 rgba(0, 242, 254, 0.2); }
    }

    .pulse-card-active {
      animation: card-pulse-neon 1.8s infinite ease-in-out;
    }

    input, select {
      outline: none;
    }
    input:focus, select:focus {
      border-color: var(--primary) !important;
      box-shadow: 0 0 0 3px var(--primary-glow);
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

  // AUTO-REFRESH FIX: Automatically recovers workflow records from DB upon user view activation or login state restoration
  useEffect(() => {
    if (activeView === 'patient' && user?.id && user.role === 'PATIENT') {
      fetchPatientItinerary(user.id);
    }
  }, [activeView, user]);

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
      loadMetadata(); 
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
      
      // Clear routing states completely to prevent validation locking on UI selections
      setAppointmentCart([]);
      setSelectedDeptId('');
      setSelectedDocId('');
      
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

  const getStatusColor = (status) => {
    switch (status) {
      case 'COMPLETED': return '#10b981'; 
      case 'CALLED': return '#00f2fe';    
      case 'WAITING': return '#fbbf24';   
      default: return '#94a3b8';
    }
  };

  return (
    <div style={{ background: '#060913', color: '#ffffff', minHeight: '100vh', fontFamily: "'Plus Jakarta Sans', sans-serif", padding: '0 0 60px 0' }}>
      
      {/* High-Contrast Glassmorphism Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(15, 21, 36, 0.9)', backdropFilter: 'blur(16px)', padding: '16px 40px', borderBottom: '1px solid rgba(255,255,255,0.1)', position: 'sticky', top: 0, zIndex: 100 }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#ffffff', margin: 0, letterSpacing: '-0.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)', width: '12px', height: '12px', borderRadius: '50%' }}></span>
          CuraFlow <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>v4.0</span>
        </h1>
        
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#060913', padding: '6px 14px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.12)' }}>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                Session Node: <strong style={{ color: '#ffffff' }}>{user.username}</strong> ({user.role})
              </span>
              <button onClick={handleLogout} style={{ background: 'transparent', border: 'none', color: '#f43f5e', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, padding: '0 0 0 10px', borderLeft: '1px solid rgba(255,255,255,0.2)' }}>
                Logout
              </button>
            </div>
          )}

          <span style={{ padding: '5px 14px', borderRadius: '20px', fontWeight: 700, background: isConnected ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)', color: isConnected ? '#10b981' : '#f43f5e', fontSize: '0.75rem', border: `1px solid ${isConnected ? '#10b981' : '#f43f5e'}` }}>
            {isConnected ? "● Network Online" : "▲ Network Failure"}
          </span>
          
          <div style={{ background: '#060913', padding: '4px', borderRadius: '24px', display: 'flex', border: '1px solid rgba(255,255,255,0.1)' }}>
            {[
              { id: 'monitor', label: 'Monitor Grid' },
              { id: 'doctor', label: 'Doctor Hub' },
              { id: 'patient', label: 'User Portal' }
            ].map((v) => (
              <button key={v.id} onClick={() => setActiveView(v.id)} style={{ padding: '8px 18px', borderRadius: '20px', background: activeView === v.id ? 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' : 'transparent', color: activeView === v.id ? '#060913' : '#94a3b8', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeNotification && (
        <div style={{ background: 'rgba(244, 63, 94, 0.2)', color: '#ffffff', borderBottom: '2px solid #f43f5e', padding: '16px 40px', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backdropFilter: 'blur(10px)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>🚨 Called Alert: {activeNotification}</span>
          <button onClick={() => setActiveNotification(null)} style={{ background: '#f43f5e', border: 'none', color: '#ffffff', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>Dismiss</button>
        </div>
      )}

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '40px' }}>
        
        {/* VIEW 1: MONITOR GRID */}
        {activeView === 'monitor' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid rgba(255,255,255,0.1)', paddingBottom: '20px', marginBottom: '35px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: '#ffffff' }}>Operational Corridor Matrix</h2>
                <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.875rem' }}>Real-time queue sequencing grids per medical ward area.</p>
              </div>
              <select value={tvSelectedDept} onChange={e => setTvSelectedDept(Number(e.target.value))} style={{ background: '#0f1524', color: '#00f2fe', border: '2px solid rgba(255,255,255,0.15)', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700 }}>
                {systemDepts.map(d => <option key={d.id} value={d.id}>{d.name.toUpperCase()}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '35px' }}>
              {systemDocs.filter(d => Number(d.department_id) === Number(tvSelectedDept)).map(doc => {
                const docQueue = queue.filter(p => Number(p.doctor_id) === Number(doc.id));
                const dynamicWaitTime = docQueue.filter(p => p.status === 'WAITING').length * (doc.average_speed || 15);
                
                return (
                  <div key={doc.id} style={{ background: '#0f1524', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '30px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.4)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '16px', marginBottom: '24px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 600, color: '#ffffff' }}>Dr. {doc.name.toUpperCase()} <span style={{ fontSize: '0.95rem', color: '#94a3b8', fontWeight: 400, marginLeft: '8px' }}>• Room {doc.room_number}</span></h3>
                      <div style={{ display: 'flex', gap: '14px', fontSize: '0.85rem' }}>
                        <span style={{ color: '#ffffff', background: 'rgba(255,255,255,0.06)', padding: '6px 14px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.08)' }}>Checkup Velocity: <strong>{doc.average_speed || 15}m</strong></span>
                        <span style={{ color: '#00f2fe', background: 'rgba(0,242,254,0.1)', padding: '6px 14px', borderRadius: '20px', fontWeight: 700, border: '1px solid rgba(0,242,254,0.2)' }}>Est. Wait: ~{dynamicWaitTime} mins</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' }}>
                      {docQueue.length === 0 ? (
                        <p style={{ color: '#576574', margin: 0, fontSize: '0.95rem', gridColumn: '1/-1' }}>No active ticket items assigned in this lane grid.</p>
                      ) : (
                        docQueue.map(p => (
                          <div key={p.id} className={p.status === 'CALLED' ? 'pulse-card-active' : ''} style={{ background: p.status === 'CALLED' ? 'rgba(0,242,254,0.06)' : '#060913', border: p.status === 'CALLED' ? '2px solid #00f2fe' : '1px solid rgba(255,255,255,0.1)', padding: '24px', borderRadius: '14px', position: 'relative' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: p.status === 'CALLED' ? '#00f2fe' : '#94a3b8', letterSpacing: '0.5px' }}>
                                {p.status === 'CALLED' ? '⚡ PROCEED TO CORRIDOR' : '📟 ENQUEUED'}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: getStatusColor(p.status), background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700 }}>
                                {p.status}
                              </span>
                            </div>
                            <h4 style={{ margin: 0, fontSize: '2.4rem', fontWeight: 700, color: '#ffffff', textAlign: 'center', letterSpacing: '1px', fontFamily: "'JetBrains Mono', monospace" }}>{p.token_number}</h4>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 2: DOCTOR HUBS */}
        {activeView === 'doctor' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {!user || user.role !== 'DOCTOR' ? (
              <div style={{ textAlign: 'center', padding: '50px', background: '#0f1524', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <p style={{ color: '#94a3b8', margin: 0, fontSize: '1rem' }}>Access Restricted. Log in inside the User Portal matching a verified Doctor credentials context.</p>
              </div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: '24px', marginBottom: '35px' }}>
                  <div style={{ background: '#0f1524', padding: '30px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                    <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: '#ffffff' }}>Dr. {user.doctorInfo?.name.toUpperCase()}</h2>
                    <p style={{ margin: '6px 0 0 0', color: '#00f2fe', fontSize: '0.9rem', fontWeight: 700 }}>Active Station Operator Console • Room ID {user.doctorInfo?.room_number}</p>
                  </div>
                  <button onClick={handleCallNext} style={{ background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', color: '#060913', border: 'none', borderRadius: '16px', cursor: 'pointer', fontWeight: 800, fontSize: '1rem', boxShadow: '0 4px 20px rgba(0,242,254,0.3)' }}>
                    🚀 Dispatch Next Token
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#94a3b8', margin: '0 0 4px 0' }}>Your Corridor Lane Rows</h3>
                  {queue.length === 0 ? (
                    <div style={{ background: '#0f1524', padding: '40px', borderRadius: '14px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <p style={{ color: '#576574', margin: 0 }}>No active enqueued lanes linked to your clinic node today.</p>
                    </div>
                  ) : (
                    queue.map((p) => (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0f1524', padding: '22px 30px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <span style={{ fontSize: '1.4rem', color: '#ffffff', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.5px' }}>&gt; {p.token_number}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                          <span style={{ fontSize: '0.85rem', color: getStatusColor(p.status), background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: '6px', fontWeight: 700 }}>{p.status}</span>
                          {p.status === 'CALLED' && (
                            <button onClick={() => handleCompleteStep(p.id, p.itinerary_id)} style={{ padding: '12px 24px', background: '#10b981', color: '#ffffff', border: 'none', cursor: 'pointer', fontWeight: 700, borderRadius: '10px', boxShadow: '0 4px 15px rgba(16,185,129,0.3)' }}>
                              ✓ Discharge & Route Next
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: USER PORTAL */}
        {activeView === 'patient' && (
          <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
            {!user ? (
              <div style={{ maxWidth: '460px', margin: '40px auto 0 auto', background: '#0f1524', padding: '40px', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 15px 35px rgba(0,0,0,0.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', marginBottom: '35px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '16px' }}>
                  <button onClick={() => setAuthMode('login')} style={{ background: 'transparent', border: 'none', color: authMode === 'login' ? '#00f2fe' : '#94a3b8', cursor: 'pointer', fontWeight: 700, fontSize: '1.05rem' }}>Sign In</button>
                  <button onClick={() => setAuthMode('signup')} style={{ background: 'transparent', border: 'none', color: authMode === 'signup' ? '#00f2fe' : '#94a3b8', cursor: 'pointer', fontWeight: 700, fontSize: '1.05rem' }}>Register Account</button>
                </div>
                
                <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {authMode === 'signup' && (
                    <input type="text" placeholder="Username / Handle" value={username} onChange={e => setUsername(e.target.value)} style={{ padding: '14px 18px', background: '#060913', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff', borderRadius: '10px', fontSize: '0.95rem' }} required />
                  )}
                  <input type="email" placeholder="Identity Email Address" value={email} onChange={e => setEmail(e.target.value)} style={{ padding: '14px 18px', background: '#060913', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff', borderRadius: '10px', fontSize: '0.95rem' }} required />
                  <input type="password" placeholder="Account Access PIN" value={password} onChange={e => setPassword(e.target.value)} style={{ padding: '14px 18px', background: '#060913', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff', borderRadius: '10px', fontSize: '0.95rem' }} required />
                  
                  {authMode === 'signup' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.95rem' }}>
                        <span style={{ color: '#94a3b8' }}>Select Gateway Role:</span>
                        <select value={userRole} onChange={e => setUserRole(e.target.value)} style={{ background: '#060913', color: '#00f2fe', border: '1px solid rgba(255,255,255,0.15)', padding: '6px 12px', borderRadius: '6px', fontWeight: 700 }}>
                          <option value="PATIENT">Patient Profile</option>
                          <option value="DOCTOR">Doctor Operator</option>
                        </select>
                      </div>

                      {userRole === 'DOCTOR' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px', background: 'rgba(0, 242, 254, 0.03)', border: '1px dashed rgba(0, 242, 254, 0.3)', borderRadius: '10px' }}>
                          <span style={{ color: '#00f2fe', fontSize: '0.85rem', fontWeight: 700 }}>Operator Metadata Context</span>
                          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Select Assigned Deployment Ward:</span>
                          <select value={selectedDeptId} onChange={e => setSelectedDeptId(e.target.value)} style={{ background: '#060913', color: '#ffffff', padding: '10px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px' }} required>
                            {systemDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                  <button type="submit" style={{ padding: '14px', background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', color: '#060913', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '0.95rem', marginTop: '10px' }}>
                    Confirm Request
                  </button>
                </form>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
                
                {/* Left Panel: Request Infrastructure */}
                <div style={{ background: '#0f1524', padding: '35px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#00f2fe', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Active Identity Token</div>
                  <h3 style={{ margin: '4px 0 30px 0', fontSize: '1.5rem', fontWeight: 700, color: '#ffffff' }}>{user.username.toUpperCase()}</h3>
                  
                  {user.role === 'PATIENT' ? (
                    <div>
                      <h4 style={{ margin: '0 0 16px 0', fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>Compile Route Pipeline</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <select value={selectedDeptId} onChange={e => { setSelectedDeptId(e.target.value); setSelectedDocId(''); }} style={{ background: '#060913', color: '#ffffff', padding: '12px 16px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', fontSize: '0.9rem' }}>
                          <option value="">-- Choose Target Ward Corridor --</option>
                          {systemDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>

                        <select value={selectedDocId} onChange={e => setSelectedDocId(e.target.value)} style={{ background: '#060913', color: '#ffffff', padding: '12px 16px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', fontSize: '0.9rem' }} required>
                          <option value="">-- Choose Specialist Practitioner --</option>
                          {systemDocs.filter(d => Number(d.department_id) === Number(selectedDeptId)).map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                        </select>

                        <button type="button" onClick={addToCart} style={{ padding: '12px', background: 'rgba(255,255,255,0.04)', color: '#00f2fe', border: '1px solid rgba(0,242,254,0.3)', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' }}>
                          + Append Destination Stop Location
                        </button>
                      </div>

                      {appointmentCart.length > 0 && (
                        <div style={{ marginTop: '30px', padding: '24px', background: '#060913', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00f2fe', letterSpacing: '0.5px' }}>ROUTE SEQUENCE DIRECTIONS MAP:</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
                            {appointmentCart.map((item, index) => (
                              <div key={index} style={{ fontSize: '0.9rem', color: '#ffffff', background: '#0f1524', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', borderLeft: '4px solid #00f2fe' }}>
                                Stop {index+1}: <strong>{item.departmentName.toUpperCase()}</strong> (Dr. {item.doctorName})
                              </div>
                            ))}
                          </div>
                          <button onClick={dispatchMultiItinerary} style={{ width: '100%', marginTop: '20px', padding: '14px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 15px rgba(16,185,129,0.3)' }}>
                            ✓ Authorize Group Routing Journey
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: '1.6' }}>Logged into verified doctor operations control lines. Shift upper tab matrix layouts to view lane queue files.</p>
                  )}
                  <button onClick={handleLogout} style={{ width: '100%', marginTop: '30px', padding: '12px', background: 'transparent', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.25)', cursor: 'pointer', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 700 }}>
                    Disconnect Session Gateway
                  </button>
                </div>

                {/* Right Panel: Active Progress Tracker */}
                <div style={{ background: '#0f1524', padding: '35px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '16px', marginBottom: '24px', fontSize: '1rem', fontWeight: 700, color: '#ffffff' }}>Daily Clinical Pipeline Monitor</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {patientItinerary.length === 0 ? (
                      <p style={{ color: '#576574', fontSize: '0.95rem', margin: 0 }}>No dynamic clinical workflows generated for this instance handle today.</p>
                    ) : (
                      patientItinerary.map((step, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', background: '#060913', padding: '18px 22px', borderRadius: '12px', border: step.status === 'CALLED' ? '2px solid #00f2fe' : '1px solid rgba(255,255,255,0.08)', justifyContent: 'space-between', boxShadow: step.status === 'CALLED' ? '0 0 15px rgba(0,242,254,0.15)' : 'none' }}>
                          <div>
                            <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '1rem' }}>{step.step_sequence}. {step.department_name.toUpperCase()}</div>
                            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '2px' }}>Dr. {step.doctor_name} (Room {step.room_number})</div>
                          </div>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: getStatusColor(step.status), background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: '20px' }}>
                            {step.status}
                          </span>
                        </div>
                      ))
                    )}
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