import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, onSnapshot, orderBy, limit, Timestamp, addDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const signOut = () => auth.signOut();

export interface UserProfile {
  uid: string;
  email: string;
  surveyResults?: string[];
  protectionProfile?: Record<string, number>;
  stats?: {
    timeSaves: number;
    moneySaves: number;
    echoSaves: number;
    rageSaves: number;
    gamblingUrges?: number;
    lustExposures?: number;
  };
}

export interface MaladyLog {
  id?: string;
  uid: string;
  maladyType: string;
  explanation: string;
  metricValue: number;
  metricType: string;
  feedback?: 'up' | 'down' | null;
  timestamp: Timestamp;
  url: string;
  flaggedText: string;
  counterPerspective?: string | null;
}

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  const userDoc = await getDoc(doc(db, 'users', uid));
  return userDoc.exists() ? (userDoc.data() as UserProfile) : null;
};

export const createUserProfile = async (user: FirebaseUser) => {
  const profile: UserProfile = {
    uid: user.uid,
    email: user.email || '',
    stats: {
      timeSaves: 0,
      moneySaves: 0,
      echoSaves: 0,
      rageSaves: 0
    }
  };
  await setDoc(doc(db, 'users', user.uid), profile);
  return profile;
};

export const updateSurveyResults = async (uid: string, results: string[]) => {
  await updateDoc(doc(db, 'users', uid), { surveyResults: results });
};

export const logMalady = async (log: Omit<MaladyLog, 'timestamp'>) => {
  const fullLog = { ...log, timestamp: Timestamp.now() };
  await addDoc(collection(db, 'malady_logs'), fullLog);
  
  // Update user stats
  const userRef = doc(db, 'users', log.uid);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    const userData = userSnap.data() as UserProfile;
    const stats = userData.stats || { timeSaves: 0, moneySaves: 0, echoSaves: 0, rageSaves: 0 };

    if (log.metricType === 'time_saved') stats.timeSaves = (stats.timeSaves || 0) + 1;
    if (log.metricType === 'money_saved') stats.moneySaves = (stats.moneySaves || 0) + 1;
    if (log.metricType === 'viewpoints') stats.echoSaves = (stats.echoSaves || 0) + 1;
    if (log.metricType === 'rage_avoided') stats.rageSaves = (stats.rageSaves || 0) + 1;
    
    await updateDoc(userRef, { stats });
  }
};

export const updateLogFeedback = async (logId: string, feedback: 'up' | 'down') => {
  await updateDoc(doc(db, 'malady_logs', logId), { feedback });
};
