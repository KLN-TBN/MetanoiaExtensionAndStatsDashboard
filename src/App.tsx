/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { auth, signIn, signOut, getUserProfile, createUserProfile, updateSurveyResults, UserProfile, MaladyLog, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Zap, Target, Eye, ShoppingCart, LogOut, ChevronRight, ThumbsUp, ThumbsDown, HelpCircle, BarChart3, Clock, DollarSign, MessageSquare, AlertTriangle, Terminal, Download } from 'lucide-react';
import JSZip from 'jszip';

const MALADIES = [
  {
    id: 'rabbit_hole',
    title: '🐇 Rabbit Hole',
    description: '“I came here for one thing and now it’s two hours later. I feel like I’ve lost control of my time and attention.”',
    metric: 'time_saved',
    metricLabel: 'Estimated Time Saved',
    unit: 'min'
  },
  {
    id: 'outrage_cycle',
    title: '😡 Outrage Cycle',
    description: '“I feel baited into being angry. I’m constantly reacting to things that upset me, and it feels like the app is fueling my frustration.”',
    metric: 'rage_avoided',
    metricLabel: 'Minutes of Rage Avoided',
    unit: 'min'
  },
  {
    id: 'echo_chamber',
    title: '⛓️ Echo Chamber',
    description: '“I feel stuck in a loop of the same ideas. My world feels smaller, and I’m only seeing information that confirms what I already believe.”',
    metric: 'viewpoints',
    metricLabel: 'New Viewpoints Provided',
    unit: 'pts'
  },
  {
    id: 'buy_now',
    title: '⏰ Buy Now Reflex',
    description: '“I feel an impulsive urge to click or buy. The interface is rushing me into decisions before I have a chance to think them through.”',
    metric: 'money_saved',
    metricLabel: 'Estimated Money Saved',
    unit: '$'
  }
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<MaladyLog[]>([]);
  const [serverLogs, setServerLogs] = useState<{ message: string, type: 'log' | 'error', timestamp: number }[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const terminalEndRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timeoutId: any = null;

    const connect = () => {
      setWsStatus('connecting');
      const wsUrl = window.location.origin.replace(/^http/, 'ws') + '/ws';
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[Metanoia] WebSocket connected');
        setWsStatus('connected');
      };

      ws.onmessage = (event) => {
        console.log('[Metanoia] Received WS message:', event.data);
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'SERVER_LOG') {
            setServerLogs(prev => [...prev.slice(-99), { 
              message: data.message, 
              type: data.logType, 
              timestamp: Date.now() 
            }]);
          }
        } catch (e) {
          console.error('WS Error:', e);
        }
      };

      ws.onclose = () => {
        ws = null;
        setWsStatus('disconnected');
        timeoutId = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [serverLogs]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // First check if profile exists, if not create it
        let p = await getUserProfile(u.uid);
        if (!p) {
          p = await createUserProfile(u);
        }
        setProfile(p);

        // Then listen for real-time updates to the profile (stats, etc.)
        const { doc, onSnapshot } = await import('firebase/firestore');
        unsubscribeProfile = onSnapshot(doc(db, 'users', u.uid), (snapshot) => {
          if (snapshot.exists()) {
            setProfile({ uid: snapshot.id, ...snapshot.data() } as UserProfile);
          }
        });
      } else {
        setProfile(null);
        if (unsubscribeProfile) unsubscribeProfile();
      }
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  useEffect(() => {
    if (user) {
      const q = query(
        collection(db, 'malady_logs'),
        where('uid', '==', user.uid),
        orderBy('timestamp', 'desc'),
        limit(50)
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const l = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaladyLog));
        setLogs(l);
      });
      return unsubscribe;
    }
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          className="w-12 h-12 border-2 border-[#00f2ff] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) return <Login />;
  if (!profile?.surveyResults || profile.surveyResults.length === 0) return <Survey uid={user.uid} onComplete={(res) => setProfile(prev => prev ? ({ ...prev, surveyResults: res }) : null)} />;

  return <Dashboard profile={profile} logs={logs} serverLogs={serverLogs} terminalEndRef={terminalEndRef} wsStatus={wsStatus} />;
}

function Login() {
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    try {
      await signIn();
    } catch (e: any) {
      setError(e?.message || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#050505]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-8"
      >
        <div className="relative inline-block">
          <Shield className="w-24 h-24 text-[#00f2ff] tron-glow" />
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="absolute inset-0 border-2 border-[#00f2ff] rounded-full opacity-30"
          />
        </div>
        <h1 className="text-6xl font-bold tracking-tighter tron-glow">METANOIA</h1>
        <p className="text-[#00f2ff]/60 max-w-md mx-auto">
          A digital immune system for your attention. Reclaim your focus from the algorithms.
        </p>
        <button onClick={handleSignIn} className="tron-button px-12 py-4 text-xl">
          Login
        </button>
        {error && <p className="text-red-400 text-base max-w-md mx-auto">{error}</p>}
      </motion.div>
    </div>
  );
}

function Survey({ uid, onComplete }: { uid: string, onComplete: (res: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleComplete = async () => {
    if (selected.length === 0) return;
    await updateSurveyResults(uid, selected);
    onComplete(selected);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h2 className="text-5xl font-bold tron-glow uppercase tracking-widest">Initial Assessment</h2>
        <p className="text-[#00f2ff]/60">Which of these scenarios do you relate to? (Select all that apply)</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
        {MALADIES.map((m) => (
          <motion.div
            key={m.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => toggle(m.id)}
            className={`tron-card cursor-pointer transition-all ${selected.includes(m.id) ? 'bg-[#00f2ff]/20 border-[#00f2ff]' : 'opacity-60'}`}
          >
            <h3 className="text-3xl font-bold mb-2">{m.title}</h3>
            <p className="text-lg text-[#00f2ff]/80 italic">{m.description}</p>
          </motion.div>
        ))}
      </div>

      <button 
        onClick={handleComplete}
        disabled={selected.length === 0}
        className={`tron-button px-12 py-3 ${selected.length === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        Establish Protection
      </button>
    </div>
  );
}

function Dashboard({ profile, logs, serverLogs, terminalEndRef, wsStatus }: { 
  profile: UserProfile, 
  logs: MaladyLog[], 
  serverLogs: { message: string, type: 'log' | 'error', timestamp: number }[],
  terminalEndRef: React.RefObject<HTMLDivElement | null>,
  wsStatus: 'connecting' | 'connected' | 'disconnected'
}) {
  const [downloading, setDownloading] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);

  // Auto-sync the extension whenever the dashboard loads with an authenticated user.
  // The content script on this page listens for METANOIA_SYNC on window, so no
  // button click is required — the user just needs the dashboard open while logged in.
  useEffect(() => {
    const appUrl = window.location.origin.replace(/\/$/, '');
    window.dispatchEvent(new CustomEvent('METANOIA_SYNC', {
      detail: { uid: profile.uid, appUrl }
    }));
  }, [profile.uid]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'REQUEST_SYNC') {
        syncWithExtension();
      }
      if (event.data?.type === 'EXTENSION_CONNECTED') {
        setExtensionConnected(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const downloadExtension = async () => {
    setDownloading(true);
    try {
      const zip = new JSZip();
      const files = [
        'manifest.json',
        'background.js',
        'content.js',
        'popup.html',
        'popup.js',
        'styles.css'
      ];

      for (const file of files) {
        const response = await fetch(`/extension/${file}`);
        const content = await response.text();
        zip.file(file, content);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'metanoia-extension.zip';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download extension:', error);
    } finally {
      setDownloading(false);
    }
  };

  const syncWithExtension = () => {
    const appUrl = window.location.origin.replace(/\/$/, '');
    window.dispatchEvent(new CustomEvent('METANOIA_SYNC', {
      detail: { uid: profile.uid, appUrl }
    }));
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-12">
      <header className="flex justify-between items-center border-b border-[#00f2ff]/20 pb-8">
        <div className="flex items-center gap-4">
          <Shield className="w-10 h-10 text-[#00f2ff]" />
          <div>
            <h1 className="text-5xl font-bold tracking-tighter tron-glow">METANOIA DASHBOARD</h1>
            <p className="text-base text-[#00f2ff]/60">USER_ID: {profile.uid.slice(0, 8)}... | STATUS: ACTIVE</p>
          </div>
        </div>
        <div className="flex gap-4 items-center">
          <div className="hidden md:flex flex-col items-end mr-4">
            <span className="text-sm uppercase tracking-widest text-[#00f2ff]/40 font-mono">Extension Status</span>
            <span className={`text-base font-mono ${extensionConnected ? 'text-green-400' : 'text-[#00f2ff]/40'}`}>
              {extensionConnected ? 'CONNECTED' : 'NOT CONNECTED'}
            </span>
          </div>
          <button onClick={signOut} className="tron-button flex items-center gap-2 text-base">
            <LogOut className="w-4 h-4" /> Disconnect
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={<Clock />} label="Time Saved" value={profile.stats?.timeSaved || 0} unit="min" color="#00f2ff" />
        <StatCard icon={<DollarSign />} label="Money Saved" value={profile.stats?.moneySaved || 0} unit="$" color="#ff00ff" />
        <StatCard icon={<Eye />} label="Viewpoints" value={profile.stats?.viewpointsProvided || 0} unit="pts" color="#00ff00" />
        <StatCard icon={<AlertTriangle />} label="Rage Avoided" value={profile.stats?.rageAvoided || 0} unit="min" color="#ff4444" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5" /> PROTECTION LOGS
          </h2>
          <div className="space-y-4">
            {logs.length === 0 ? (
              <div className="tron-card text-center py-12 text-[#00f2ff]/40">
                No threats detected yet. Continue browsing safely.
              </div>
            ) : (
              logs.map(log => <LogItem key={log.id} log={log} />)
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="tron-card border-[#ff00ff]/50 bg-[#ff00ff]/5">
            <h2 className="text-2xl font-bold flex items-center gap-2 text-[#ff00ff] mb-4">
              <Zap className="w-5 h-5" /> INSTALL EXTENSION
            </h2>
            <div className="mb-4">
              <button 
                onClick={downloadExtension}
                disabled={downloading}
                className="tron-button w-full flex items-center justify-center gap-2 text-base border-[#ff00ff] text-[#ff00ff] hover:bg-[#ff00ff]/10"
              >
                <Download className={`w-4 h-4 ${downloading ? 'animate-bounce' : ''}`} />
                {downloading ? 'Preparing ZIP...' : 'Download Extension ZIP'}
              </button>
            </div>
            <ol className="text-base space-y-3 text-[#ff00ff]/80 list-decimal pl-4">
              <li>Download the extension source code above.</li>
              <li>Unzip the file to a folder on your computer.</li>
              <li>Open <code className="bg-black px-1">chrome://extensions</code> in Chrome.</li>
              <li>Enable "Developer mode" (top right).</li>
              <li>Click "Load unpacked" and select the unzipped folder.</li>
              <li>Click "Sync Extension" above to link your account.</li>
            </ol>
          </div>

          <h2 className="text-3xl font-bold flex items-center gap-2">
            <Target className="w-5 h-5" /> PROTECTION FOCUS
          </h2>
          <div className="tron-card space-y-4">
            {MALADIES.map(m => (
              <div key={m.id} className={`flex items-center justify-between p-2 border-l-2 ${profile.surveyResults?.includes(m.id) ? 'border-[#00f2ff] bg-[#00f2ff]/5' : 'border-transparent opacity-40'}`}>
                <span className="text-lg">{m.title}</span>
                {profile.surveyResults?.includes(m.id) && <Zap className="w-4 h-4 text-[#00f2ff] animate-pulse" />}
              </div>
            ))}
          </div>
          
          <div className="tron-card bg-magenta-900/10 border-[#ff00ff]/30">
            <h3 className="text-lg font-bold text-[#ff00ff] mb-2 uppercase tracking-tighter">System Note</h3>
            <p className="text-base text-[#ff00ff]/70 leading-relaxed">
              Metanoia is learning from your feedback. Thumbs up/down on flagged content helps refine the detection algorithm for your specific triggers.
            </p>
          </div>

          <div className="tron-card border-[#00f2ff]/50 bg-black/50 h-[300px] flex flex-col">
            <h3 className="text-base font-bold text-[#00f2ff] mb-2 uppercase tracking-widest flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4" /> LIVE_TERMINAL_LOGS
              </div>
              <div className={`text-xs px-1 rounded ${
                wsStatus === 'connected' ? 'bg-green-500/20 text-green-400' : 
                wsStatus === 'connecting' ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' : 
                'bg-red-500/20 text-red-400'
              }`}>
                {wsStatus.toUpperCase()}
              </div>
            </h3>
            <div className="flex-1 overflow-y-auto font-mono text-sm space-y-1 custom-scrollbar pr-2">
              {serverLogs.length === 0 && <div className="text-[#00f2ff]/20 italic">Waiting for system activity...</div>}
              {serverLogs.map((log, i) => (
                <div key={i} className={`${log.type === 'error' ? 'text-red-400' : 'text-[#00f2ff]/80'}`}>
                  <span className="opacity-30">[{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}]</span> {log.message}
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function StatCard({ icon, label, value, unit, color }: { icon: React.ReactNode, label: string, value: number, unit: string, color: string }) {
  return (
    <div className="tron-card" style={{ borderColor: `${color}44` }}>
      <div className="flex items-center gap-3 mb-4 opacity-70" style={{ color }}>
        {icon}
        <span className="text-base uppercase tracking-widest">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-6xl font-bold tron-glow" style={{ color }}>{value}</span>
        <span className="text-base opacity-50">{unit}</span>
      </div>
    </div>
  );
}

function LogItem({ log }: { log: MaladyLog, key?: string }) {

  const malady = MALADIES.find(m => m.id === log.maladyType);
  
  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="tron-card group"
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="font-bold text-[#00f2ff]">{malady?.title || log.maladyType}</h3>
          <p className="text-sm text-[#00f2ff]/40 uppercase tracking-tighter">
            {log.timestamp.toDate().toLocaleString()} | {new URL(log.url).hostname}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold px-2 py-1 border border-[#00f2ff]/30 rounded">
            +{log.metricValue} {malady?.unit}
          </span>
        </div>
      </div>
      
      <p className="text-lg text-[#00f2ff]/80 mb-4 border-l border-[#00f2ff]/20 pl-4 italic">
        "{log.flaggedText.slice(0, 150)}..."
      </p>
      
      {log.counterPerspective && (
        <div className="mb-4 p-3 bg-[#00ff00]/5 border-l-2 border-[#00ff00] rounded-r">
          <div className="text-sm uppercase tracking-widest text-[#00ff00] font-bold mb-1">Counter Perspective</div>
          <p className="text-base text-[#00ff00]/80 italic">{log.counterPerspective}</p>
        </div>
      )}
      
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-base text-[#00f2ff]/60">
            <HelpCircle className="w-3 h-3" />
            <span>{log.explanation}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button className={`p-1 rounded transition-colors ${log.feedback === 'up' ? 'bg-[#00f2ff] text-[#050505]' : 'hover:bg-[#00f2ff]/20'}`}>
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button className={`p-1 rounded transition-colors ${log.feedback === 'down' ? 'bg-[#ff4444] text-[#050505]' : 'hover:bg-[#ff4444]/20'}`}>
            <ThumbsDown className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

