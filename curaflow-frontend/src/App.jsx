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
    @keyframes status-blink {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

function App() {
  const [queue, setQueue] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeView, setActiveView] = useState('monitor'); 
  
  // Authentication & Session States
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userRole, setUserRole] = useState('PATIENT');

  // Intake / Multi-Service Routing Selection States
  const [selectedDepts, setSelectedDepts] = useState([]);
  const [selectedPriority, setSelectedPriority] = useState('MEDIUM');
  const [patientItinerary, setPatientItinerary] = useState([]);

  // Available institutional facilities metadata
  const hospitalDepartments = [
    { id: 1, name: 'OPD - Cardiology', code: 'CARD' },
    { id: 2, name: 'OPD - Pulmonology', code: 'PEDS' },
    { id: 3, name: 'Radiology (Scans Room)', code: 'SCAN' },
    { id: 4, name: 'Hematology (Blood Checking)', code: 'LAB' }
  ];

  // System Operators Context Constants
  const currentDepartmentId = 3; 
  const currentDoctorId = 3;      

  const fetchQueue = () => {
    fetch(`${BACKEND_URL}/api/queue/${currentDepartmentId}`)
      .then((res) => res.json())
      .then((data) => setQueue(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Error fetching queue:", err));
  };

  const fetchPatientItinerary = (id) => {
    if (!id) return;
    fetch(`${BACKEND_URL}/api/itinerary/patient/${id}`)
      .then(res => res.json())
      .then(data => setPatientItinerary(data))
      .catch(err => console.error("Error fetching itinerary:", err));
  };

  useEffect(() => {
    fetchQueue();

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    socket.on("queue_updated", (data) => {
      if (Number(data.departmentId) === Number(currentDepartmentId)) {
        setQueue(Array.isArray(data.queue) ? data.queue : []);
      }
    });

    socket.on("patient_movement_trigger", (data) => {
      if (user && user.role === 'PATIENT') {
        fetchPatientItinerary(user.id);
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("queue_updated");
      socket.off("patient_movement_trigger");
    };
  }, [user]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
    const payload = authMode === 'login' 
      ? { email, password } 
      : { username, email, password, role: userRole };

    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Authentication verification failed.");
      
      if (authMode === 'signup') {
        alert("Registration complete. Switching to session initialisation login.");
        setAuthMode('login');
        return;
      }

      setUser(data.user);
      if (data.user.role === 'PATIENT') {
        setActiveView('patient');
        fetchPatientItinerary(data.user.id);
      } else {
        setActiveView('doctor');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateItinerary = async (e) => {
    e.preventDefault();
    if (selectedDepts.length === 0) return alert("Select at least one clinical facility target.");
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/itinerary/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: user.id,
          departmentIds: selectedDepts,
          priority: selectedPriority
        })
      });
      const data = await res.json();
      alert(`Optimization schedule constructed! Assigned Token: ${data.token}`);
      fetchPatientItinerary(user.id);
      setSelectedDepts([]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCallNext = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/queue/next`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId: currentDoctorId, departmentId: currentDepartmentId }),
      });
    } catch (err) {
      console.error("Error triggering next patient:", err);
    }
  };

  const handleCompleteStep = async (stepId, itineraryId, seq) => {
    try {
      await fetch(`${BACKEND_URL}/api/queue/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId, itineraryId, currentSequence: seq, departmentId: currentDepartmentId }),
      });
      fetchQueue();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleDeptSelection = (id) => {
    if (selectedDepts.includes(id)) {
      setSelectedDepts(selectedDepts.filter(d => d !== id));
    } else {
      setSelectedDepts([...selectedDepts, id]);
    }
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
    <div style={{ 
      background: '#0b0e14', color: '#d1d5db', minHeight: '100vh', 
      fontFamily: 'Consolas, Monaco, "SF Pro Mono", monospace'
    }}>
      
      {/* Telemetry Header */}
      <div style={{ 
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
        background: '#111622', padding: '16px 40px', borderBottom: '1px solid #1f293d'
      }}>
        <h1 style={{ fontSize: '1.2rem', color: '#ffffff', margin: 0, letterSpacing: '2px' }}>
          SYS.CURAFLOW // <span style={{ color: '#576574', fontSize: '0.9rem' }}>V4.0</span>
        </h1>
        
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <span style={{ 
            padding: '2px 8px', borderRadius: '4px', 
            border: `1px solid ${isConnected ? '#2ecc71' : '#e74c3c'}`, color: isConnected ? '#2ecc71' : '#e74c3c', fontSize: '0.7rem'
          }}>
            {isConnected ? "● NET_OK" : "▲ NET_ERR"}
          </span>

          <div style={{ background: '#0b0e14', padding: '3px', borderRadius: '6px', display: 'flex', border: '1px solid #1f293d' }}>
            {['monitor', 'doctor', 'patient'].map((view) => (
              <button 
                key={view} onClick={() => setActiveView(view)} 
                style={{ 
                  padding: '6px 16px', background: activeView === view ? '#1f293d' : 'transparent', 
                  color: activeView === view ? '#00ced1' : '#576574', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', textTransform: 'uppercase'
                }}
              >
                {view === 'monitor' ? 'SYS_BOARD_TV' : view === 'doctor' ? 'CTRL_STATION' : 'USER_PORTAL'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '40px' }}>
        
        {/* VIEW 1: DYNAMIC SYSTEM DISPLAY MONITOR */}
        {activeView === 'monitor' && (
          <div>
            <div style={{ borderBottom: '1px solid #1f293d', paddingBottom: '15px', marginBottom: '30px' }}>
              <h2>[DEPT_03_TRIAGE_MATRIX]</h2>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
              {queue.length === 0 ? (
                <p style={{ color: '#4b5563' }}>NO ACTIVE DATA RECORDS FOUND.</p>
              ) : (
                queue.map((p) => {
                  const isCalled = p.status === 'CALLED';
                  return (
                    <div 
                      key={p.id || p.token_number} 
                      style={{ 
                        background: isCalled ? '#12252e' : '#111622', 
                        border: isCalled ? '1px solid #00ced1' : '1px solid #1f293d', 
                        padding: '30px 24px', borderRadius: '8px',
                        animation: isCalled ? 'pulse-border 2.5s infinite ease-in-out' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                        <span style={{ fontSize: '0.7rem', color: isCalled ? '#00ced1' : '#576574' }}>
                          {isCalled ? '◀ LIVE_DISPATCH' : '📟 ENQUEUED'}
                        </span>
                        <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: isCalled ? '#00ced1' : '#1f293d', color: isCalled ? '#0b0e14' : '#9ca3af' }}>
                          {p.status}
                        </span>
                      </div>
                      <h3 style={{ fontSize: '2.4rem', margin: '0', color: '#fff' }}>{p.token_number}</h3>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: INDUSTRIAL DOCTOR CONTROL CONSOLE */}
        {activeView === 'doctor' && (
          <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', marginBottom: '30px' }}>
              <div style={{ background: '#111622', padding: '24px', borderRadius: '8px', border: '1px solid #1f293d' }}>
                <div style={{ fontSize: '0.7rem', color: '#576574' }}>Operator Context</div>
                <h2 style={{ fontSize: '1.2rem', margin: '5px 0', color: '#fff' }}>DR. S. JENKINS // PEDS_RM103</h2>
                <div style={{ fontSize: '0.75rem', color: '#00ced1' }}>SYSTEM STATUS: READY_TO_DISPATCH</div>
              </div>

              <button onClick={handleCallNext} style={{ background: '#1f293d', color: '#00ced1', border: '1px solid #00ced1', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>
                ⚡ DISPATCH NEXT REQ
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {queue.map((p) => {
                const priority = getPriorityStyle(p.priority);
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#111622', padding: '14px 20px', borderRadius: '6px', border: '1px solid #1f293d' }}>
                    <span style={{ fontSize: '1rem', color: '#fff' }}>&gt; {p.token_number}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <span style={{ padding: '2px 8px', fontSize: '0.65rem', background: priority.bg, border: `1px solid ${priority.border}`, color: priority.text }}>
                        {p.priority}
                      </span>
                      {p.status === 'CALLED' && (
                        <button 
                          onClick={() => handleCompleteStep(p.id, p.itinerary_id, p.step_sequence)}
                          style={{ padding: '4px 10px', background: '#2ecc71', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: '700' }}
                        >
                          ✓ COMPLETE & ROUTE NEXT
                        </button>
                      )}
                      <span style={{ padding: '4px 10px', fontSize: '0.7rem', background: '#1f293d', color: '#9ca3af' }}>{p.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 3: INTEGRATED USER SECURE GATEWAY & ITINERARY CHECK-IN MANAGER */}
        {activeView === 'patient' && (
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {!user ? (
              <div style={{ maxWidth: '450px', margin: '0 auto', background: '#111622', padding: '35px', borderRadius: '12px', border: '1px solid #1f293d' }}>
                <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '25px', borderBottom: '1px solid #1f293d', paddingBottom: '10px' }}>
                  <button onClick={() => setAuthMode('login')} style={{ background: 'transparent', border: 'none', color: authMode === 'login' ? '#00ced1' : '#576574', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }}>[01_SIGN_IN]</button>
                  <button onClick={() => setAuthMode('signup')} style={{ background: 'transparent', border: 'none', color: authMode === 'signup' ? '#00ced1' : '#576574', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }}>[02_REGISTRATION]</button>
                </div>

                <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {authMode === 'signup' && (
                    <input type="text" placeholder="Username Handle" value={username} onChange={e => setUsername(e.target.value)} style={{ padding: '12px', background: '#0b0e14', border: '1px solid #1f293d', color: '#fff', borderRadius: '6px', fontFamily: 'monospace' }} required />
                  )}
                  <input type="email" placeholder="Identity Corporate Email" value={email} onChange={e => setEmail(e.target.value)} style={{ padding: '12px', background: '#0b0e14', border: '1px solid #1f293d', color: '#fff', borderRadius: '6px', fontFamily: 'monospace' }} required />
                  <input type="password" placeholder="Secure Password Hash Key" value={password} onChange={e => setPassword(e.target.value)} style={{ padding: '12px', background: '#0b0e14', border: '1px solid #1f293d', color: '#fff', borderRadius: '6px', fontFamily: 'monospace' }} required />
                  
                  {authMode === 'signup' && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', color: '#576574' }}>ROLE SPECIFICATION:</span>
                      <select value={userRole} onChange={e => setUserRole(e.target.value)} style={{ background: '#0b0e14', color: '#00ced1', border: '1px solid #1f293d', padding: '6px', borderRadius: '4px', fontFamily: 'monospace' }}>
                        <option value="PATIENT">PATIENT_CLIENT</option>
                        <option value="DOCTOR">DOCTOR_OPERATOR</option>
                      </select>
                    </div>
                  )}

                  <button type="submit" style={{ padding: '12px', background: '#00ced1', color: '#0b0e14', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', textTransform: 'uppercase', fontSize: '0.8rem' }}>
                    {authMode === 'login' ? 'EXECUTE INITIALIZE' : 'COMMIT REGISTRATION RECORD'}
                  </button>
                </form>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                
                {/* Left Side: Medical Intake Selection (Dynamic Multi-Stop Registration Interface) */}
                <div style={{ background: '#111622', padding: '30px', borderRadius: '12px', border: '1px solid #1f293d' }}>
                  <div style={{ fontSize: '0.75rem', color: '#576574', textTransform: 'uppercase' }}>Session Initialized // {user.role}</div>
                  <h3 style={{ margin: '5px 0 25px 0', color: '#fff' }}>WELCOME, {user.username.toUpperCase()}</h3>
                  
                  {user.role === 'PATIENT' ? (
                    <form onSubmit={handleCreateItinerary} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={{ fontSize: '0.8rem', color: '#fff', borderBottom: '1px solid #1f293d', paddingBottom: '8px' }}>[INTAKE_FACILITY_ROUTING_TARGETS]</div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {hospitalDepartments.map((dept) => (
                          <label key={dept.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: '#0b0e14', border: '1px solid #1f293d', borderRadius: '6px', cursor: 'pointer' }}>
                            <input 
                              type="checkbox" 
                              checked={selectedDepts.includes(dept.id)} 
                              onChange={() => handleToggleDeptSelection(dept.id)}
                              style={{ accentColor: '#00ced1' }}
                            />
                            <span style={{ fontSize: '0.85rem', color: selectedDepts.includes(dept.id) ? '#00ced1' : '#fff' }}>
                              {dept.name} [{dept.code}]
                            </span>
                          </label>
                        ))}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: '#576574' }}>TRIAGE SEVERITY RANK:</span>
                        <select value={selectedPriority} onChange={e => setSelectedPriority(e.target.value)} style={{ background: '#0b0e14', color: '#fff', border: '1px solid #1f293d', padding: '6px', borderRadius: '4px', fontFamily: 'monospace' }}>
                          <option value="LOW">LOW</option>
                          <option value="MEDIUM">MEDIUM</option>
                          <option value="HIGH">HIGH</option>
                          <option value="EMERGENCY">EMERGENCY</option>
                        </select>
                      </div>

                      <button type="submit" style={{ width: '100%', padding: '12px', background: 'rgba(0, 206, 209, 0.1)', color: '#00ced1', border: '1px solid #00ced1', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.75rem' }}>
                        ⚙ BUILD OPTIMIZED ROUTING PATHWAY
                      </button>
                    </form>
                  ) : (
                    <p style={{ color: '#576574', fontSize: '0.85rem' }}>Doctor operations panel available. Use the CTRL_STATION toggle above to access active dispatch matrices.</p>
                  )}
                  
                  <button onClick={() => { setUser(null); setPatientItinerary([]); }} style={{ width: '100%', marginTop: '25px', padding: '10px', background: '#1c1f26', color: '#9ca3af', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700' }}>TERMINATE SESSION</button>
                </div>

                {/* Right Side: Patient Daily Dynamic Telemetry Timeline Progress */}
                <div style={{ background: '#111622', padding: '30px', borderRadius: '12px', border: '1px solid #1f293d' }}>
                  <div style={{ borderBottom: '1px solid #1f293d', paddingBottom: '15px', marginBottom: '25px' }}>
                    <div style={{ fontSize: '#0.85rem', color: '#fff' }}>[DAILY_CLINICAL_ITINERARY_TRACKER]</div>
                    {patientItinerary.length > 0 && (
                      <div style={{ color: '#00ced1', fontSize: '0.8rem', marginTop: '5px' }}>ACTIVE_TOKEN_REF: {patientItinerary[0].token_number}</div>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {patientItinerary.length === 0 ? (
                      <p style={{ color: '#4b5563', fontSize: '0.85rem' }}>NO REGISTERED TRACKING TICKETS FOUND FOR TODAY.</p>
                    ) : (
                      patientItinerary.map((step, index) => {
                        const isActive = step.status === 'CALLED' || step.status === 'IN_CONSULTATION';
                        return (
                          <div key={index} style={{ 
                            display: 'flex', gap: '15px', alignItems: 'center', 
                            background: isActive ? 'rgba(0, 206, 209, 0.04)' : '#0b0e14', 
                            padding: '16px', borderRadius: '6px', 
                            border: isActive ? '1px solid #00ced1' : '1px solid #1f293d' 
                          }}>
                            <div style={{ 
                              width: '26px', height: '26px', borderRadius: '50%', 
                              background: step.status === 'COMPLETED' ? '#2ecc71' : isActive ? '#00ced1' : '#1f293d', 
                              display: 'flex', alignItems: 'center', justifyContent: 'center', 
                              fontSize: '0.75rem', color: '#0b0e14', fontWeight: '700' 
                            }}>
                              {step.step_sequence}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ color: '#fff', fontWeight: '700', fontSize: '0.9rem' }}>{step.department_name}</div>
                              <div style={{ fontSize: '0.75rem', color: '#576574' }}>Severity Rank: {step.priority}</div>
                            </div>
                            <span style={{ 
                              fontSize: '0.7rem', fontWeight: '700', 
                              color: step.status === 'COMPLETED' ? '#2ecc71' : isActive ? '#00ced1' : '#4b5563' 
                            }}>
                              {step.status}
                            </span>
                          </div>
                        );
                      })
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