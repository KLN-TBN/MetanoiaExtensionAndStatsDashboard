document.getElementById('dashboardBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://metanoia-stats-dashboard-797861117032.us-west1.run.app' });
});

document.getElementById('syncBtn').addEventListener('click', () => {
  // We'll tell the background script to try and sync from the open dashboard tab
  chrome.tabs.query({ url: '*://metanoia-stats-dashboard-797861117032.us-west1.run.app/*' }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'REQUEST_SYNC' });
      document.getElementById('status').innerText = 'SYNC REQUEST SENT';
    } else {
      document.getElementById('status').innerText = 'OPEN DASHBOARD FIRST';
    }
  });
});

chrome.storage.local.get(['uid', 'appUrl'], (result) => {
  if (result.uid && result.appUrl) {
    document.getElementById('status').innerText = 'CONNECTED: ' + result.uid.slice(0, 8);
  } else {
    document.getElementById('status').innerText = 'NOT CONNECTED';
  }
});
