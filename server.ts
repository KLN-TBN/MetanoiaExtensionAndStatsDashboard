import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const PORT = 3000;

  // Wrap console.log and console.error early
  const originalLog = console.log;
  const originalError = console.error;

  // Broadcast logs to all connected WebSocket clients
  const broadcastLog = (message: string, type: 'log' | 'error' = 'log') => {
    const payload = JSON.stringify({ type: 'SERVER_LOG', message, logType: type });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  console.log = (...args) => {
    originalLog(...args);
    broadcastLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
  };

  console.error = (...args) => {
    originalError(...args);
    broadcastLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '), 'error');
  };

  console.log("[Metanoia Server] Starting server...");

  // Load Firebase Config
  let firebaseConfig;
  try {
    const configPath = path.join(__dirname, "firebase-applet-config.json");
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error("[Metanoia Server] CRITICAL: Failed to load firebase-applet-config.json", err);
    process.exit(1);
  }

  // Initialize Firebase Admin
  console.log("[Metanoia Server] Initializing Firebase Admin...");
  try {
    const adminConfig: any = { projectId: firebaseConfig.projectId };
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      adminConfig.credential = cert(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    }
    initializeApp(adminConfig);
    console.log("[Metanoia Server] Firebase Admin initialized.");
  } catch (err) {
    console.error("[Metanoia Server] Firebase Admin Init Error:", err);
  }
  
  // Use the specific databaseId if provided
  console.log(`[Metanoia Server] Connecting to Firestore database: ${firebaseConfig.firestoreDatabaseId || '(default)'}`);
  const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(firebaseConfig.firestoreDatabaseId)
    : getFirestore();
  console.log("[Metanoia Server] Firestore connection established.");

  // Handle WebSocket upgrades manually
  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch (err) {
      originalError("[Metanoia Server] Upgrade Error:", err);
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    originalLog(`[Metanoia Server] WebSocket client connected from ${ip}`);
    ws.send(JSON.stringify({ type: 'SERVER_LOG', message: `Connected to Metanoia Live Terminal (IP: ${ip})`, logType: 'log' }));
  });

  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json());
  app.use(express.text({ type: 'text/plain' }));

  // Middleware to parse JSON from text/plain (helps bypass CORS preflight)
  app.use((req, res, next) => {
    if (req.headers['content-type'] === 'text/plain' && typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
      } catch (e) {
        // Not valid JSON, continue
      }
    }
    next();
  });

  // Request Logger
  app.use((req, res, next) => {
    if (req.method !== 'OPTIONS') {
      console.log(`[Metanoia Server] ${req.method} ${req.originalUrl || req.url}`);
    }
    next();
  });

  // Health check route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API Route for scanning content
  app.post("/api/scan", async (req, res) => {
    const { text, userId, url } = req.body;
    console.log(`[Metanoia Server] Scan request: User=${userId}, URL=${url}, Text=${text?.length} chars`);
    
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;

    if (!apiKey) {
      console.error("[Metanoia Server] Error: Missing GEMINI_API_KEY");
      return res.status(500).json({ error: "Missing GEMINI_API_KEY on server. Please check your Secrets in AI Studio." });
    }

    if (!text) {
      console.error("[Metanoia Server] Error: No text provided");
      return res.status(400).json({ error: "Missing text to scan." });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `
        You are a digital wellness expert. Analyze the following web page content for 4 specific digital maladies. Be thorough and flag content that uses manipulative or attention-grabbing patterns.

        Maladies to look for:
        1. Rabbit Hole: Content designed to trap attention for long periods (e.g., "You won't believe...", infinite scroll triggers, clickbait).
        2. Outrage Cycle: Content designed to provoke anger, frustration, or fear (e.g., polarizing headlines, rage-bait, inflammatory language).
        3. Echo Chamber: Content that reinforces biases, limits viewpoints, or uses "us vs them" rhetoric.
        4. Buy Now Reflex: Dark patterns, high-pressure sales tactics, artificial scarcity (e.g., "Only 2 left!", "Offer ends in 5 mins").

        Return a JSON array of found maladies. If none are found, return an empty array [].
        Each object MUST have:
        - maladyType: (rabbit_hole, outrage_cycle, echo_chamber, buy_now)
        - title: This MUST be one of the 4 malady names (Rabbit Hole, Outrage Cycle, Echo Chamber, Buy Now Reflex).
        - explanation: A concise explanation (1-2 sentences) of why this was flagged.
        - flaggedText: The specific short snippet of text (5-15 words) that triggered this. This MUST be an exact substring from the provided content.
        
        Optional fields (only include if you are highly confident):
        - metricValue: Estimated value (minutes for time/rage, dollars for money, points for viewpoints). ONLY include if there is a clear basis for estimation (e.g., video length, price tag, specific time claim). If unsure, OMIT this field.
        - metricType: (time_saved, money_saved, viewpoints, rage_avoided)
        - unit: (min, $, pts)
        
        Special field for Echo Chamber:
        - counterPerspective: If maladyType is 'echo_chamber', provide a brief (1 sentence) alternative viewpoint or a question that prompts critical thinking about the flagged content.

        Page Content:
        ${text}

        Return ONLY the JSON array.
      `;

      console.log("[Metanoia Server] Calling Gemini API...");
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const rawMaladies = JSON.parse(response.text);
      const VALID_TYPES = new Set(['rabbit_hole', 'outrage_cycle', 'echo_chamber', 'buy_now']);
      const normalizedSource = text.toLowerCase().replace(/\s+/g, ' ');
      const maladies = rawMaladies.filter((m: any) => {
        if (!VALID_TYPES.has(m.maladyType)) return false;
        if (!m.flaggedText) return false;
        const normalizedFlagged = m.flaggedText.toLowerCase().trim().replace(/\s+/g, ' ');
        const found = normalizedSource.includes(normalizedFlagged);
        if (!found) console.warn(`[Metanoia Server] Discarding malady — flaggedText not found in source: "${m.flaggedText}"`);
        return found;
      });
      console.log(`[Metanoia Server] Found ${maladies.length} verified maladies (${rawMaladies.length} raw from Gemini).`);

      // Log maladies to Firestore using Admin SDK
      if (maladies.length > 0 && userId) {
        for (const malady of maladies) {
          try {
            const logData = {
              uid: userId,
              maladyType: malady.maladyType,
              explanation: malady.explanation,
              metricValue: malady.metricValue || 0,
              metricType: malady.metricType || 'none',
              url: url || 'unknown',
              flaggedText: malady.flaggedText,
              counterPerspective: malady.counterPerspective || null,
              timestamp: Timestamp.now()
            };
            const docRef = await db.collection('malady_logs').add(logData);
            malady.logId = docRef.id;
            
            // Update user stats only if metricValue exists and is positive
            if (malady.metricValue && malady.metricValue > 0) {
              const userRef = db.collection('users').doc(userId);
              const userSnap = await userRef.get();
              if (userSnap.exists) {
                const userData = userSnap.data() || {};
                const stats = userData.stats || { timeSaved: 0, moneySaved: 0, viewpointsProvided: 0, rageAvoided: 0 };
                
                if (malady.metricType === 'time_saved') stats.timeSaved += malady.metricValue;
                if (malady.metricType === 'money_saved') stats.moneySaved += malady.metricValue;
                if (malady.metricType === 'viewpoints') stats.viewpointsProvided += malady.metricValue;
                if (malady.metricType === 'rage_avoided') stats.rageAvoided += malady.metricValue;
                
                await userRef.update({ stats });
              }
            }
          } catch (logError: any) {
            console.error("[Metanoia Server] Firestore Log Error:", logError?.message || logError?.code || JSON.stringify(logError));
          }
        }
      }
      
      res.json({ maladies });
    } catch (error) {
      console.error("[Metanoia Server] API Error:", error);
      res.status(500).json({ error: "Failed to scan content." });
    }
  });

  // API Route for feedback
  app.post("/api/feedback", async (req, res) => {
    const { logId, feedback, userId } = req.body;
    console.log(`[Metanoia Server] Feedback received: Log=${logId}, Feedback=${feedback}, User=${userId}`);

    if (!logId || !feedback) {
      return res.status(400).json({ error: "Missing logId or feedback." });
    }

    try {
      // Update the log entry
      const logRef = db.collection('malady_logs').doc(logId);
      await logRef.update({ feedback });

      // If we have a userId, we can potentially adjust their protection profile
      // This is a "learning" feature
      if (userId) {
        const logSnap = await logRef.get();
        if (logSnap.exists) {
          const logData = logSnap.data();
          const maladyType = logData?.maladyType;
          
          if (maladyType && feedback === 'down') {
            // If user says "not helpful" (down), maybe they want LESS of this flagged?
            // Or maybe it was a false positive. 
            // For now, let's just log it. 
            console.log(`[Metanoia Server] User ${userId} flagged ${maladyType} as NOT helpful.`);
          }
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Metanoia Server] Feedback Error:", error);
      res.status(500).json({ error: "Failed to save feedback." });
    }
  });

  // Catch-all for API routes
  app.all("/api/*", (req, res) => {
    console.warn(`[Metanoia Server] 404 API: ${req.method} ${req.url}`);
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Metanoia Server running on http://localhost:${PORT}`);
  });
}

startServer();
