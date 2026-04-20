/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { auth, signIn, signOut, getUserProfile, createUserProfile, updateSurveyResults, updateLogFeedback, UserProfile, MaladyLog, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Zap, Target, Eye, LogOut, ThumbsUp, ThumbsDown, HelpCircle, BarChart3, Clock, DollarSign, AlertTriangle, Download } from 'lucide-react';
import JSZip from 'jszip';

const MALADIES = [
  {
    id: 'rabbit_hole',
    title: '🐇 Rabbit Hole',
    description: '"I came here for one thing and now it\'s two hours later. I feel like I\'ve lost control of my time and attention."',
    metric: 'time_saved',
    metricLabel: 'Estimated Time Saved',
    unit: 'min',
    color: '#00f2ff'
  },
  {
    id: 'outrage_cycle',
    title: '😡 Outrage Cycle',
    description: '"I feel baited into being angry. I\'m constantly reacting to things that upset me, and it feels like the app is fueling my frustration."',
    metric: 'rage_avoided',
    metricLabel: 'Minutes of Rage Avoided',
    unit: 'min',
    color: '#ff4444'
  },
  {
    id: 'echo_chamber',
    title: '⛓️ Echo Chamber',
    description: '"I feel stuck in a loop of the same ideas. My world feels smaller, and I\'m only seeing information that confirms what I already believe."',
    metric: 'viewpoints',
    metricLabel: 'New Viewpoints Provided',
    unit: 'pts',
    color: '#00ff00'
  },
  {
    id: 'buy_now',
    title: '⏰ Buy Now Reflex',
    description: '"I feel an impulsive urge to click or buy. The interface is rushing me into decisions before I have a chance to think them through."',
    metric: 'money_saved',
    metricLabel: 'Estimated Money Saved',
    unit: '$',
    color: '#ff00ff'
  },
  {
    id: 'gambling_trigger',
    title: '🎰 Gambling Trigger',
    description: '"I get pulled into sports betting, casino apps, or "free bet" offers. The odds feel designed to keep me hooked."',
    metric: 'urge_avoided',
    metricLabel: 'Gambling Urges Blocked',
    unit: '',
    color: '#ffd700'
  },
  {
    id: 'lust_trigger',
    title: '🔞 Lust Trigger',
    description: '"I keep getting drawn into pornographic or sexually suggestive content online, even when I don\'t intend to."',
    metric: 'exposure_avoided',
    metricLabel: 'Exposures Blocked',
    unit: '',
    color: '#ff69b4'
  }
];

function getHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<MaladyLog[]>([]);
  const [logsInitialized, setLogsInitialized] = useState(false);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        let p = await getUserProfile(u.uid);
        if (!p) {
          p = await createUserProfile(u);
        }
        setProfile(p);

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
      setLogsInitialized(false);
      const q = query(
        collection(db, 'malady_logs'),
        where('uid', '==', user.uid),
        orderBy('timestamp', 'desc'),
        limit(50)
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const l = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaladyLog));
        setLogs(l);
        setLogsInitialized(true);
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

  return <Dashboard user={user} profile={profile} logs={logs} logsInitialized={logsInitialized} />;
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
  const [freeText, setFreeText] = useState('');
  const [interpreting, setInterpreting] = useState(false);
  const [interpretedSummary, setInterpretedSummary] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleInterpret = async () => {
    if (!freeText.trim()) return;
    setInterpreting(true);
    setInterpretedSummary(null);
    try {
      const res = await fetch('/api/interpret-struggles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: freeText.trim() })
      });
      const data = await res.json();
      if (data.maladies?.length > 0) {
        setSelected(prev => Array.from(new Set([...prev, ...data.maladies])));
        setInterpretedSummary(data.summary || null);
      } else {
        setInterpretedSummary("I couldn't match that to a specific pattern — try selecting from the cards above.");
      }
    } catch {
      setInterpretedSummary('Something went wrong. Try selecting from the cards above.');
    } finally {
      setInterpreting(false);
    }
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
        <p className="text-[#00f2ff]/60">What are you trying to protect yourself from online? Select all that apply.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
        {MALADIES.map((m) => {
          const isSelected = selected.includes(m.id);
          return (
            <motion.div
              key={m.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => toggle(m.id)}
              className="tron-card cursor-pointer transition-all"
              style={{
                borderColor: isSelected ? m.color : undefined,
                background: isSelected ? `${m.color}18` : undefined,
                opacity: isSelected ? 1 : 0.6,
              }}
            >
              <h3 className="text-2xl font-bold mb-2" style={{ color: isSelected ? m.color : undefined }}>{m.title}</h3>
              <p className="text-base text-[#00f2ff]/80 italic">{m.description}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="w-full tron-card space-y-4">
        <p className="text-base text-[#00f2ff]/60">Or describe your struggle in your own words:</p>
        <textarea
          value={freeText}
          onChange={e => setFreeText(e.target.value)}
          placeholder="e.g. I keep falling into gambling sites after sports games..."
          className="w-full bg-transparent border border-[#00f2ff]/30 rounded p-3 text-[#00f2ff] placeholder-[#00f2ff]/30 text-base resize-none focus:outline-none focus:border-[#00f2ff]/70"
          rows={3}
        />
        <button
          onClick={handleInterpret}
          disabled={!freeText.trim() || interpreting}
          className={`tron-button px-6 py-2 text-sm ${!freeText.trim() || interpreting ? 'opacity-30 cursor-not-allowed' : ''}`}
        >
          {interpreting ? 'Interpreting...' : 'Let Metanoia Interpret'}
        </button>
        {interpretedSummary && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-base text-[#00f2ff]/80 italic border-l-2 border-[#00f2ff]/40 pl-3"
          >
            {interpretedSummary}
          </motion.p>
        )}
      </div>

      <button
        onClick={handleComplete}
        disabled={selected.length === 0}
        className={`tron-button px-12 py-3 text-lg ${selected.length === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
      >
        Establish Protection {selected.length > 0 ? `(${selected.length} active)` : ''}
      </button>
    </div>
  );
}

function Dashboard({ user, profile, logs, logsInitialized }: {
  user: User,
  profile: UserProfile,
  logs: MaladyLog[],
  logsInitialized: boolean,
}) {
  const [downloading, setDownloading] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [logFilter, setLogFilter] = useState<string>('all');
  const [editingFocus, setEditingFocus] = useState(false);
  const [focusDraft, setFocusDraft] = useState<string[]>([]);
  const [savingFocus, setSavingFocus] = useState(false);

  const syncWithExtension = () => {
    const appUrl = window.location.origin.replace(/\/$/, '');
    const displayName = user.displayName || user.email || null;
    window.dispatchEvent(new CustomEvent('METANOIA_SYNC', {
      detail: { uid: profile.uid, appUrl, enabledMaladies: profile.surveyResults || [], displayName }
    }));
  };

  useEffect(() => {
    syncWithExtension();
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

  const displayName = user.displayName || user.email || profile.uid.slice(0, 8) + '...';
  const filteredLogs = logFilter === 'all' ? logs : logs.filter(l => l.maladyType === logFilter);

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-12">
      <header className="flex justify-between items-center border-b border-[#00f2ff]/20 pb-8">
        <div className="flex items-center gap-4">
          <Shield className="w-10 h-10 text-[#00f2ff]" />
          <div>
            <h1 className="text-5xl font-bold tracking-tighter tron-glow">METANOIA</h1>
            <p className="text-base text-[#00f2ff]/60">{displayName}</p>
          </div>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex flex-col items-end mr-4">
            <span className="text-sm uppercase tracking-widest text-[#00f2ff]/40 font-mono">Extension</span>
            <span className={`text-base font-mono ${extensionConnected ? 'text-green-400' : 'text-[#00f2ff]/40'}`}>
              {extensionConnected ? 'CONNECTED' : 'NOT CONNECTED'}
            </span>
          </div>
          <button onClick={signOut} className="tron-button flex items-center gap-2 text-base">
            <LogOut className="w-4 h-4" /> Disconnect
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={<Clock />} label="Time Saves" value={profile.stats?.timeSaves || 0} color="#00f2ff" />
        <StatCard icon={<DollarSign />} label="Money Saves" value={profile.stats?.moneySaves || 0} color="#ff00ff" />
        <StatCard icon={<Eye />} label="Echo Saves" value={profile.stats?.echoSaves || 0} color="#00ff00" />
        <StatCard icon={<AlertTriangle />} label="Rage Saves" value={profile.stats?.rageSaves || 0} color="#ff4444" />
        <StatCard icon={<Zap />} label="Urges Avoided" value={profile.stats?.gamblingUrges || 0} color="#ffd700" />
        <StatCard icon={<Shield />} label="Exposures Blocked" value={profile.stats?.lustExposures || 0} color="#ff69b4" />
      </div>

      {/* Install extension guide appears first on mobile for new users */}
      <div className="block lg:hidden">
        <InstallExtensionCard downloading={downloading} onDownload={downloadExtension} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-3xl font-bold flex items-center gap-2">
              <BarChart3 className="w-5 h-5" /> PROTECTION LOGS
            </h2>
            <div className="flex gap-2 flex-wrap">
              {['all', ...MALADIES.map(m => m.id)].map(id => {
                const malady = MALADIES.find(m => m.id === id);
                const label = id === 'all' ? 'ALL' : malady?.title.split(' ').slice(1).join(' ').toUpperCase() || id;
                const color = malady?.color || '#00f2ff';
                const active = logFilter === id;
                return (
                  <button
                    key={id}
                    onClick={() => setLogFilter(id)}
                    className="px-3 py-1 text-xs uppercase tracking-widest border transition-all"
                    style={{
                      borderColor: active ? color : `${color}44`,
                      color: active ? '#050505' : color,
                      background: active ? color : 'transparent',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-4">
            {!logsInitialized ? (
              <LogsSkeleton />
            ) : filteredLogs.length === 0 ? (
              <EmptyLogsState hasFilter={logFilter !== 'all'} extensionConnected={extensionConnected} />
            ) : (
              filteredLogs.map(log => <LogItem key={log.id} log={log} />)
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Hidden on mobile since it rendered above */}
          <div className="hidden lg:block">
            <InstallExtensionCard downloading={downloading} onDownload={downloadExtension} />
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-bold flex items-center gap-2">
              <Target className="w-5 h-5" /> PROTECTION FOCUS
            </h2>
            {!editingFocus ? (
              <button
                onClick={() => { setFocusDraft(profile.surveyResults || []); setEditingFocus(true); }}
                className="text-xs uppercase tracking-widest border border-[#00f2ff]/40 text-[#00f2ff]/60 hover:text-[#00f2ff] hover:border-[#00f2ff] px-3 py-1 transition-colors"
              >
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingFocus(false)}
                  className="text-xs uppercase tracking-widest border border-[#00f2ff]/30 text-[#00f2ff]/40 hover:text-[#00f2ff]/70 px-3 py-1 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (focusDraft.length === 0) return;
                    setSavingFocus(true);
                    await updateSurveyResults(profile.uid, focusDraft);
                    syncWithExtension();
                    setEditingFocus(false);
                    setSavingFocus(false);
                  }}
                  disabled={savingFocus || focusDraft.length === 0}
                  className={`text-xs uppercase tracking-widest border border-[#00f2ff] text-[#00f2ff] bg-[#00f2ff]/10 hover:bg-[#00f2ff]/20 px-3 py-1 transition-colors ${savingFocus || focusDraft.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  {savingFocus ? 'Saving...' : 'Save'}
                </button>
              </div>
            )}
          </div>
          <div className="tron-card space-y-2">
            {MALADIES.map(m => {
              const active = editingFocus ? focusDraft.includes(m.id) : profile.surveyResults?.includes(m.id);
              return (
                <div
                  key={m.id}
                  onClick={() => {
                    if (!editingFocus) return;
                    setFocusDraft(prev => prev.includes(m.id) ? prev.filter(i => i !== m.id) : [...prev, m.id]);
                  }}
                  className={`flex items-center justify-between p-2 border-l-2 transition-all ${editingFocus ? 'cursor-pointer hover:opacity-90' : ''}`}
                  style={{
                    borderColor: active ? m.color : 'transparent',
                    background: active ? `${m.color}0d` : 'transparent',
                    opacity: active ? 1 : 0.3,
                  }}
                >
                  <span className="text-lg" style={{ textDecoration: active ? 'none' : 'line-through' }}>{m.title}</span>
                  {editingFocus ? (
                    <div
                      className="w-4 h-4 border rounded-sm flex items-center justify-center flex-shrink-0"
                      style={{ borderColor: m.color, background: active ? m.color : 'transparent' }}
                    >
                      {active && <span className="text-[#050505] text-xs font-bold leading-none">✓</span>}
                    </div>
                  ) : (
                    active && <Zap className="w-4 h-4 animate-pulse" style={{ color: m.color }} />
                  )}
                </div>
              );
            })}
            {editingFocus && focusDraft.length === 0 && (
              <p className="text-xs text-[#ff4444]/70 pt-1 pl-2">Select at least one to save.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

function InstallExtensionCard({ downloading, onDownload }: { downloading: boolean, onDownload: () => void }) {
  return (
    <div className="tron-card border-[#ff00ff]/50 bg-[#ff00ff]/5">
      <h2 className="text-2xl font-bold flex items-center gap-2 text-[#ff00ff] mb-4">
        <Zap className="w-5 h-5" /> INSTALL EXTENSION
      </h2>
      <div className="mb-4">
        <button
          onClick={onDownload}
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
        <li>Open any webpage — the extension will activate automatically.</li>
      </ol>
    </div>
  );
}

function StatCard({ icon, label, value, unit, prefix, color }: { icon: React.ReactNode, label: string, value: number, unit?: string, prefix?: string, color: string }) {
  const rounded = Math.round(value);
  return (
    <div className="tron-card" style={{ borderColor: `${color}44` }}>
      <div className="flex items-center gap-3 mb-4 opacity-70" style={{ color }}>
        {icon}
        <span className="text-base uppercase tracking-widest">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        {prefix && <span className="text-3xl font-bold opacity-70" style={{ color }}>{prefix}</span>}
        <motion.span
          key={rounded}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-6xl font-bold tron-glow"
          style={{ color }}
        >
          {rounded}
        </motion.span>
        {unit && <span className="text-base opacity-50 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

function EmptyLogsState({ hasFilter, extensionConnected }: { hasFilter: boolean, extensionConnected: boolean }) {
  const message = hasFilter
    ? 'No detections match this filter.'
    : extensionConnected
      ? 'All clear — no patterns detected yet. Keep browsing normally.'
      : 'Install the extension above to start detecting patterns while you browse.';

  return (
    <div className="tron-card no-scan text-center py-12 text-[#00f2ff]/40">
      <motion.div
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
        className="inline-block mb-4"
      >
        <Shield className="w-12 h-12 mx-auto opacity-30" />
      </motion.div>
      <p>{message}</p>
    </div>
  );
}

function LogsSkeleton() {
  return (
    <>
      {[0, 1, 2].map(i => (
        <div key={i} className="tron-card no-scan animate-pulse space-y-3">
          <div className="h-4 bg-[#00f2ff]/10 rounded w-1/3" />
          <div className="h-3 bg-[#00f2ff]/10 rounded w-1/2" />
          <div className="h-3 bg-[#00f2ff]/10 rounded w-full" />
          <div className="h-3 bg-[#00f2ff]/10 rounded w-5/6" />
        </div>
      ))}
    </>
  );
}

function LogItem({ log }: { log: MaladyLog, key?: React.Key }) {
  const malady = MALADIES.find(m => m.id === log.maladyType);
  const color = malady?.color || '#00f2ff';
  const [feedback, setFeedback] = useState<'up' | 'down' | null | undefined>(log.feedback);
  const [expanded, setExpanded] = useState(false);
  const isLong = log.flaggedText.length > 150;
  const displayText = expanded || !isLong ? log.flaggedText : log.flaggedText.slice(0, 150) + '...';

  const handleFeedback = async (val: 'up' | 'down') => {
    if (!log.id) return;
    const next = feedback === val ? null : val;
    setFeedback(next);
    if (next) await updateLogFeedback(log.id, next);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="tron-card no-scan group"
      style={{ borderLeftColor: color, borderLeftWidth: '3px' }}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="font-bold" style={{ color }}>{malady?.title || log.maladyType}</h3>
          <p className="text-sm text-[#00f2ff]/40 uppercase tracking-tighter">
            {log.timestamp.toDate().toLocaleString()} | {getHostname(log.url)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold px-2 py-1 border border-[#00f2ff]/30 rounded">
            {malady?.unit === '$' ? `+$${Math.round(log.metricValue)}` : `+${Math.round(log.metricValue)} ${malady?.unit ?? ''}`}
          </span>
        </div>
      </div>

      <p className="text-lg text-[#00f2ff]/80 mb-2 border-l border-[#00f2ff]/20 pl-4 italic">
        "{displayText}"
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-xs text-[#00f2ff]/50 hover:text-[#00f2ff] uppercase tracking-widest mb-4 pl-4 transition-colors"
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      )}

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
          <button
            onClick={() => handleFeedback('up')}
            className={`p-1 rounded transition-colors ${feedback === 'up' ? 'bg-[#00f2ff] text-[#050505]' : 'hover:bg-[#00f2ff]/20'}`}
            aria-label="Helpful"
          >
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleFeedback('down')}
            className={`p-1 rounded transition-colors ${feedback === 'down' ? 'bg-[#ff4444] text-[#050505]' : 'hover:bg-[#ff4444]/20'}`}
            aria-label="Not helpful"
          >
            <ThumbsDown className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
