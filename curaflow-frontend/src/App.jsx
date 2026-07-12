import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const BACKEND_URL = "http://localhost:5000";
const socket = io(BACKEND_URL);

// Inject global keyframe animations directly into the document head for performance
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
  const departmentId = 3; 
  const doctorId = 3;     

  const fetchQueue = () => {
    fetch(`${BACKEND_URL}/api/queue/${departmentId}`)
      .then((res) => res.json())
      .then((data) => setQueue(Array.isArray(data) ? data : data.rows || []))
      .catch((err) => console.error("Error fetching queue:", err));
  };

  useEffect(() => {
    fetchQueue();

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    socket.on("queue_updated", (data) => {
      if (Number(data.departmentId) === Number(departmentId)) {
        setQueue(Array.isArray(data.queue) ? data.queue : []);
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("queue_updated");
    };
  }, []);

  const handleCallNext = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/queue/next`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId, departmentId }),
      });
      await response.json();
    } catch (err) {
      console.error("Error triggering next patient:", err);
    }
  };

  // Industrial System Priority Colors (Stealthy, utilitarian look)
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
      padding: '0', 
      background: '#0b0e14', 
      color: '#d1d5db', 
      minHeight: '100vh', 
      fontFamily: 'Consolas, Monaco, "SF Pro Mono", monospace',
      letterSpacing: '-0.01em'
    }}>
      
      {/* Precision Telemetry Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        background: '#111622', 
        padding: '16px 40px',
        borderBottom: '1px solid #1f293d',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <h1 style={{ 
            fontSize: '1.2rem', 
            fontWeight: '700', 
            color: '#ffffff',
            margin: 0,
            letterSpacing: '2px',
            textTransform: 'uppercase'
          }}>
            SYS.CURAFLOW // <span style={{ color: '#576574', fontSize: '0.9rem' }}>V4.0</span>
          </h1>
          <span style={{ 
            padding: '2px 8px', 
            borderRadius: '4px', 
            background: isConnected ? 'rgba(46, 204, 113, 0.08)' : 'rgba(231, 76, 60, 0.08)',
            border: `1px solid ${isConnected ? '#2ecc71' : '#e74c3c'}`,
            color: isConnected ? '#2ecc71' : '#e74c3c', 
            fontSize: '0.7rem', 
            fontWeight: '700',
            textTransform: 'uppercase',
            animation: isConnected ? 'none' : 'status-blink 1.5s infinite ease-in-out'
          }}>
            {isConnected ? "● NET_OK" : "▲ NET_ERR"}
          </span>
        </div>
        
        {/* Utilitarian Control Toggles */}
        <div style={{ background: '#0b0e14', padding: '3px', borderRadius: '6px', display: 'flex', border: '1px solid #1f293d' }}>
          {['monitor', 'doctor'].map((view) => (
            <button 
              key={view}
              onClick={() => setActiveView(view)} 
              style={{ 
                padding: '6px 16px', 
                background: activeView === view ? '#1f293d' : 'transparent', 
                color: activeView === view ? '#00ced1' : '#576574', 
                border: 'none', 
                borderRadius: '4px', 
                cursor: 'pointer', 
                fontWeight: '700',
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              {view === 'monitor' ? 'SYS_BOARD_TV' : 'CTRL_STATION'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '40px' }}>
        
        {/* VIEW 1: DYNAMIC SYSTEM DISPLAY MONITOR */}
        {activeView === 'monitor' && (
          <div>
            <div style={{ borderBottom: '1px solid #1f293d', paddingBottom: '15px', marginBottom: '30px' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#fff', textTransform: 'uppercase', margin: 0 }}>[DEPT_03_TRIAGE_MATRIX]</h2>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
              {queue.length === 0 ? (
                <p style={{ color: '#4b5563', fontSize: '0.9rem' }}>NO ACTIVE DATA RECORDS FOUND.</p>
              ) : (
                queue.map((p) => {
                  const isCalled = p.status === 'CALLED';
                  return (
                    <div 
                      key={p.token_number} 
                      style={{ 
                        background: isCalled ? '#12252e' : '#111622', 
                        border: isCalled ? '1px solid #00ced1' : '1px solid #1f293d', 
                        padding: '30px 24px', 
                        borderRadius: '8px',
                        animation: isCalled ? 'pulse-border 2.5s infinite ease-in-out' : 'none',
                        transition: 'transform 0.3s ease, background-color 0.3s ease',
                        position: 'relative'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <span style={{ fontSize: '0.7rem', color: isCalled ? '#00ced1' : '#576574', fontWeight: '700' }}>
                          {isCalled ? '◀ LIVE_DISPATCH' : '📟 ENQUEUED'}
                        </span>
                        <span style={{ 
                          fontSize: '0.65rem', 
                          padding: '2px 6px', 
                          background: isCalled ? '#00ced1' : '#1f293d',
                          color: isCalled ? '#0b0e14' : '#9ca3af',
                          fontWeight: '700'
                        }}>
                          {p.status}
                        </span>
                      </div>
                      <h3 style={{ fontSize: '2.4rem', fontWeight: '700', margin: '0', color: '#fff', letterSpacing: '-1px' }}>
                        {p.token_number}
                      </h3>
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
            
            {/* Upper Telemetry Deck */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', marginBottom: '30px' }}>
              <div style={{ background: '#111622', padding: '24px', borderRadius: '8px', border: '1px solid #1f293d' }}>
                <div style={{ fontSize: '0.7rem', color: '#576574', fontWeight: '700', textTransform: 'uppercase' }}>Operator Context</div>
                <h2 style={{ fontSize: '1.2rem', fontWeight: '700', margin: '5px 0', color: '#fff' }}>DR. S. JENKINS // PEDS_RM103</h2>
                <div style={{ fontSize: '0.75rem', color: '#00ced1' }}>SYSTEM STATUS: READY_TO_DISPATCH</div>
              </div>

              {/* High-Impact Mechanical Style Trigger Button */}
              <button 
                onClick={handleCallNext}
                style={{ 
                  background: '#1f293d', 
                  color: '#00ced1', 
                  border: '1px solid #00ced1', 
                  borderRadius: '8px', 
                  cursor: 'pointer', 
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  padding: '20px',
                  transition: 'all 0.2s ease',
                  boxShadow: 'inset 0 0 0 0 rgba(0, 206, 209, 0.2)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#00ced1';
                  e.currentTarget.style.color = '#0b0e14';
                  e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 206, 209, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#1f293d';
                  e.currentTarget.style.color = '#00ced1';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                ⚡ DISPATCH NEXT REQ
              </button>
            </div>

            {/* Industrial Row List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 16px', fontSize: '0.7rem', color: '#576574', fontWeight: '700', textTransform: 'uppercase' }}>
                <span>Token Ref</span>
                <div style={{ display: 'flex', gap: '60px' }}>
                  <span>Triage Rank</span>
                  <span>Execution State</span>
                </div>
              </div>

              {queue.map((p) => {
                const priority = getPriorityStyle(p.priority);
                const isCalled = p.status === 'CALLED';

                return (
                  <div 
                    key={p.token_number} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      background: isCalled ? 'rgba(0, 206, 209, 0.03)' : '#111622', 
                      padding: '14px 20px', 
                      borderRadius: '6px',
                      border: isCalled ? '1px solid #00ced1' : '1px solid #1f293d',
                      transition: 'transform 0.2s ease',
                      cursor: 'default'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateX(4px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateX(0)'}
                  >
                    <span style={{ fontSize: '1rem', fontWeight: '700', color: isCalled ? '#00ced1' : '#fff' }}>
                      &gt; {p.token_number}
                    </span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      {/* Industrial Utilitarian Priority Badge */}
                      <span style={{ 
                        padding: '2px 8px', 
                        borderRadius: '3px', 
                        fontSize: '0.65rem', 
                        fontWeight: '700',
                        background: priority.bg,
                        border: `1px solid ${priority.border}`,
                        color: priority.text
                      }}>
                        {p.priority}
                      </span>
                      
                      {/* Status State Flag */}
                      <span style={{ 
                        padding: '4px 10px', 
                        borderRadius: '4px', 
                        fontSize: '0.7rem', 
                        fontWeight: '700',
                        background: isCalled ? '#00ced1' : '#1f293d', 
                        color: isCalled ? '#0b0e14' : '#9ca3af',
                        minWidth: '70px',
                        textAlign: 'center'
                      }}>
                        {p.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}

export default App;