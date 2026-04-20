// background.js
// We'll need to get the App URL and User ID from storage
let APP_URL = null;
let USER_ID = null;
let DISPLAY_NAME = null;
let ENABLED_MALADIES = [];
let ws = null;

// Relay logs to all active tabs
function relayLog(message, type = 'log', source = 'Background') {
  const logMessage = `[Metanoia ${source}] ${message}`;
  if (type === 'error') {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SERVER_LOG',
        message: logMessage,
        logType: type
      }).catch(() => {}); // Ignore errors for inactive tabs
    });
  });
}

function connectWebSocket() {
  if (!APP_URL || ws) return;

  const wsUrl = APP_URL.replace(/^http/, 'ws') + '/ws';
  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'SERVER_LOG') {
        relayLog(data.message, data.logType, 'Server');
      }
    } catch (e) {
      console.error('WS Error:', e);
    }
  };

  ws.onclose = () => {
    ws = null;
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (err) => {
    console.error('WS Error:', err);
    ws.close();
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SCAN_PAGE') {
    relayLog(`Starting scan for URL: ${request.url}`);
    handleScan(request.text, request.url, request.imageUrls || []).then(sendResponse);
    return true; // Keep channel open for async
  }
  if (request.type === 'FEEDBACK') {
    relayLog(`Feedback: ${request.logId} -> ${request.feedback}`);
    handleFeedback(request.logId, request.feedback);
  }
  if (request.type === 'SET_CONFIG') {
    APP_URL = request.appUrl ? request.appUrl.replace(/\/$/, '') : null;
    USER_ID = request.uid;
    DISPLAY_NAME = request.displayName || null;
    ENABLED_MALADIES = request.enabledMaladies || [];
    chrome.storage.local.set({ appUrl: APP_URL, uid: request.uid, displayName: DISPLAY_NAME, enabledMaladies: ENABLED_MALADIES });
    connectWebSocket();
  }
});

// Initialize from storage
chrome.storage.local.get(['appUrl', 'uid', 'displayName', 'enabledMaladies'], (result) => {
  APP_URL = result.appUrl ? result.appUrl.replace(/\/$/, '') : null;
  USER_ID = result.uid;
  DISPLAY_NAME = result.displayName || null;
  ENABLED_MALADIES = result.enabledMaladies || [];
  if (APP_URL) connectWebSocket();
});

async function handleScan(text, url, imageUrls) {
  if (!APP_URL || !USER_ID) {
    const errorMsg = 'Extension not synced with dashboard. Please click "Sync Extension" in the Metanoia Dashboard.';
    relayLog(errorMsg, 'error');
    return { maladies: [], imageMaladies: [], error: errorMsg };
  }

  try {
    const fetchUrl = `${APP_URL}/api/scan`;
    relayLog(`Sending request to: ${fetchUrl}`);
    const response = await fetch(fetchUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        text: text,
        userId: USER_ID,
        url: url,
        enabledMaladies: ENABLED_MALADIES,
        imageUrls: imageUrls || []
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      relayLog(`Server returned error: ${response.status} ${responseText.slice(0, 100)}`, 'error');
      return { maladies: [], error: `Server Error: ${response.status}` };
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      relayLog(`Failed to parse JSON response: ${responseText.slice(0, 100)}...`, 'error');
      return { maladies: [], error: 'Invalid server response format.' };
    }
    
    relayLog(`Received response from server. Found ${data.maladies?.length || 0} maladies, ${data.imageMaladies?.length || 0} image maladies.`);

    if (data.error) {
      relayLog(`API Error: ${data.error}`, 'error');
      return { maladies: [], imageMaladies: [], error: data.error };
    }

    return { maladies: data.maladies || [], imageMaladies: data.imageMaladies || [] };
  } catch (error) {
    relayLog(`Fetch Error: ${error.message}`, 'error');
    return { maladies: [], imageMaladies: [], error: 'Network connection failed.' };
  }
}


async function handleFeedback(logId, feedback) {
  if (!APP_URL || !USER_ID) return;

  try {
    const fetchUrl = `${APP_URL}/api/feedback`;
    relayLog(`Sending feedback to: ${fetchUrl}`);
    await fetch(fetchUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        logId: logId,
        feedback: feedback,
        userId: USER_ID
      })
    });
    relayLog(`Feedback saved for log: ${logId}`);
  } catch (error) {
    relayLog(`Feedback Error: ${error.message}`, 'error');
  }
}
