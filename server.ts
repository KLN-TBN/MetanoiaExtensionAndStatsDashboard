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

const VALID_MALADY_TYPES = new Set(['rabbit_hole', 'outrage_cycle', 'echo_chamber', 'buy_now', 'gambling_trigger', 'lust_trigger']);

const MALADY_DEFINITIONS: Record<string, string> = {
  rabbit_hole: 'Rabbit Hole: Content designed to trap attention for long periods (e.g., "You won\'t believe...", infinite scroll triggers, clickbait).',
  outrage_cycle: 'Outrage Cycle: Content designed to provoke anger, frustration, or fear (e.g., polarizing headlines, rage-bait, inflammatory language).',
  echo_chamber: 'Echo Chamber: Content that reinforces biases, limits viewpoints, or uses "us vs them" rhetoric.',
  buy_now: 'Buy Now Reflex: Dark patterns, high-pressure sales tactics, artificial scarcity (e.g., "Only 2 left!", "Offer ends in 5 mins").',
  gambling_trigger: 'Gambling Trigger: Content that promotes gambling or exploits gambling psychology — odds manipulation, loss-chasing rhetoric, jackpot framing, "free bet" dark patterns, casino promotions, betting odds.',
  lust_trigger: 'Lust Trigger: Sexually suggestive or explicit content in text form — suggestive headlines, lust-bait titles, explicit descriptions, or content designed to exploit sexual desire.'
};

const MALADY_METRIC_TYPE: Record<string, string> = {
  rabbit_hole: 'time_saved',
  outrage_cycle: 'rage_avoided',
  echo_chamber: 'viewpoints',
  buy_now: 'money_saved',
  gambling_trigger: 'urge_avoided',
  lust_trigger: 'exposure_avoided'
};

async function scanImages(ai: GoogleGenAI, imageUrls: string[]): Promise<any[]> {
  const LIMIT = 8;
  const urls = imageUrls.slice(0, LIMIT);
  const imageParts: any[] = [];
  const urlMap: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) continue;
      const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      if (!contentType.startsWith('image/')) continue;
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      imageParts.push({ inlineData: { mimeType: contentType, data: base64 } });
      urlMap.push(url);
    } catch {
      // Skip images that can't be fetched
    }
  }

  if (imageParts.length === 0) return [];

  const imagePrompt = `You are a content moderation assistant. Analyze these images and identify which ones contain sexually suggestive or explicit content (lust triggers) — including suggestive poses, revealing clothing, sexual imagery, or content designed to exploit sexual desire.

For each image that IS a lust trigger, return a JSON object with:
- imageIndex: the 0-based index of the image (0 = first image after this text)
- explanation: brief explanation of why it's flagged (1 sentence)

Return a JSON array. If no images are flagged, return [].`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ role: 'user', parts: [{ text: imagePrompt }, ...imageParts] }],
      config: { responseMimeType: 'application/json' }
    });
    const results = JSON.parse(response.text);
    return (Array.isArray(results) ? results : [])
      .map((r: any) => ({
        maladyType: 'lust_trigger',
        imageUrl: urlMap[r.imageIndex] || null,
        explanation: r.explanation || 'Sexually suggestive image detected.'
      }))
      .filter((r: any) => r.imageUrl);
  } catch (e) {
    console.error('[Metanoia Server] Image scan error:', e);
    return [];
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const PORT = parseInt(process.env.PORT || "3000", 10);

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
    const { text, userId, url, enabledMaladies: rawEnabledMaladies, imageUrls } = req.body;
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

    // Resolve which malady types to scan for
    const allTypes = Array.from(VALID_MALADY_TYPES);
    const enabledMaladies: string[] = Array.isArray(rawEnabledMaladies) && rawEnabledMaladies.length > 0
      ? rawEnabledMaladies.filter((t: string) => VALID_MALADY_TYPES.has(t))
      : allTypes;
    const enabledSet = new Set(enabledMaladies);

    try {
      const ai = new GoogleGenAI({ apiKey });

      // Build dynamic prompt from only the enabled malady types
      const maladyList = enabledMaladies
        .map((id, i) => `${i + 1}. ${MALADY_DEFINITIONS[id]}`)
        .join('\n');
      const validTypesList = enabledMaladies.join(', ');

      const prompt = `
        You are a digital wellness expert. Analyze the following web page content for specific digital maladies. Be thorough and flag content that uses manipulative or attention-grabbing patterns.

        Maladies to look for:
        ${maladyList}

        Return a JSON array of found maladies. If none are found, return an empty array [].
        Each object MUST have:
        - maladyType: one of (${validTypesList})
        - title: The display name of the malady type.
        - explanation: A concise explanation (1-2 sentences) of why this was flagged.
        - flaggedText: The specific short snippet of text (5-15 words) that triggered this. This MUST be an exact substring from the provided content.

        Optional fields (only include if you are highly confident):
        - metricValue: Estimated value (minutes for time/rage/urge, dollars for money, points for viewpoints). ONLY include if there is a clear basis for estimation. If unsure, OMIT this field.
        - metricType: one of (time_saved, money_saved, viewpoints, rage_avoided, urge_avoided, exposure_avoided)
        - unit: (min, $, pts)

        Special field for Echo Chamber only:
        - counterPerspective: A brief (1 sentence) alternative viewpoint or question prompting critical thinking.

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
      const normalizedSource = text.toLowerCase().replace(/\s+/g, ' ');
      const maladies = rawMaladies.filter((m: any) => {
        if (!enabledSet.has(m.maladyType)) return false;
        if (!m.flaggedText) return false;
        const normalizedFlagged = m.flaggedText.toLowerCase().trim().replace(/\s+/g, ' ');
        const found = normalizedSource.includes(normalizedFlagged);
        if (!found) console.warn(`[Metanoia Server] Discarding malady — flaggedText not found in source: "${m.flaggedText}"`);
        return found;
      });
      console.log(`[Metanoia Server] Found ${maladies.length} verified maladies (${rawMaladies.length} raw from Gemini).`);

      // Image scan for lust_trigger
      let imageMaladies: any[] = [];
      if (enabledSet.has('lust_trigger') && Array.isArray(imageUrls) && imageUrls.length > 0) {
        console.log(`[Metanoia Server] Scanning ${imageUrls.length} images for lust_trigger...`);
        imageMaladies = await scanImages(ai, imageUrls);
        console.log(`[Metanoia Server] Image scan found ${imageMaladies.length} lust triggers.`);
      }

      // Log maladies to Firestore using Admin SDK
      if (maladies.length > 0 && userId) {
        for (const malady of maladies) {
          try {
            const metricType = MALADY_METRIC_TYPE[malady.maladyType] || 'none';
            const logData = {
              uid: userId,
              maladyType: malady.maladyType,
              explanation: malady.explanation,
              metricValue: malady.metricValue || 0,
              metricType,
              url: url || 'unknown',
              flaggedText: malady.flaggedText,
              counterPerspective: malady.counterPerspective || null,
              timestamp: Timestamp.now()
            };
            const docRef = await db.collection('malady_logs').add(logData);
            malady.logId = docRef.id;

            if (metricType !== 'none') {
              const userRef = db.collection('users').doc(userId);
              const userSnap = await userRef.get();
              if (userSnap.exists) {
                const userData = userSnap.data() || {};
                const stats = userData.stats || { timeSaves: 0, moneySaves: 0, echoSaves: 0, rageSaves: 0, gamblingUrges: 0, lustExposures: 0 };

                if (metricType === 'time_saved') stats.timeSaves = (stats.timeSaves || 0) + 1;
                if (metricType === 'money_saved') stats.moneySaves = (stats.moneySaves || 0) + 1;
                if (metricType === 'viewpoints') stats.echoSaves = (stats.echoSaves || 0) + 1;
                if (metricType === 'rage_avoided') stats.rageSaves = (stats.rageSaves || 0) + 1;
                if (metricType === 'urge_avoided') stats.gamblingUrges = (stats.gamblingUrges || 0) + 1;
                if (metricType === 'exposure_avoided') stats.lustExposures = (stats.lustExposures || 0) + 1;

                await userRef.update({ stats });
              }
            }
          } catch (logError: any) {
            console.error("[Metanoia Server] Firestore Log Error:", logError?.message || logError?.code || JSON.stringify(logError));
          }
        }
      }

      // Log image maladies to Firestore
      if (imageMaladies.length > 0 && userId) {
        for (const malady of imageMaladies) {
          try {
            const logData = {
              uid: userId,
              maladyType: 'lust_trigger',
              explanation: malady.explanation,
              metricValue: 1,
              metricType: 'exposure_avoided',
              url: url || 'unknown',
              flaggedText: malady.imageUrl,
              counterPerspective: null,
              timestamp: Timestamp.now()
            };
            const imageDocRef = await db.collection('malady_logs').add(logData);
            malady.logId = imageDocRef.id;
            const userRef = db.collection('users').doc(userId);
            const userSnap = await userRef.get();
            if (userSnap.exists) {
              const userData = userSnap.data() || {};
              const stats = userData.stats || {};
              stats.lustExposures = (stats.lustExposures || 0) + 1;
              await userRef.update({ stats });
            }
          } catch (logError: any) {
            console.error("[Metanoia Server] Image Firestore Log Error:", logError?.message || logError?.code || JSON.stringify(logError));
          }
        }
      }

      res.json({ maladies, imageMaladies });
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

  // API Route for interpreting free-text struggles into malady types
  app.post("/api/interpret-struggles", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are helping a user set up a digital wellness tool called Metanoia. Based on their description of what they struggle with online, identify which of the following protection categories apply.

Categories:
- rabbit_hole: Losing time to endless scrolling, clickbait, or "just one more" content traps
- outrage_cycle: Getting pulled into angry, rage-bait, or emotionally provocative content
- echo_chamber: Only seeing content that confirms existing beliefs, filter bubbles
- buy_now: Impulse buying, dark patterns, high-pressure sales tactics
- gambling_trigger: Gambling urges, online betting, casino content, sports betting
- lust_trigger: Pornography, sexually suggestive content, lust-bait

User's description: "${text}"

Return a JSON object with:
- maladies: array of matching category IDs from the list above (only include categories that clearly match)
- summary: a warm, empathetic 1-sentence confirmation of what Metanoia will protect them from (e.g., "Got it — I'll watch for gambling triggers and lust bait for you.")

Return ONLY the JSON object.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text);
      const validMaladies = (result.maladies || []).filter((m: string) => VALID_MALADY_TYPES.has(m));
      res.json({ maladies: validMaladies, summary: result.summary || '' });
    } catch (error) {
      console.error("[Metanoia Server] Interpret struggles error:", error);
      res.status(500).json({ error: "Failed to interpret struggles." });
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
