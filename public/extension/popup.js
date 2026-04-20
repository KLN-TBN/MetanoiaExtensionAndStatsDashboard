document.getElementById('dashboardBtn').addEventListener('click', () => {
  chrome.storage.local.get(['appUrl'], (result) => {
    const url = result.appUrl || 'https://metanoia-stats-dashboard-797861117032.us-west1.run.app';
    chrome.tabs.create({ url });
  });
});

chrome.storage.local.get(['uid', 'appUrl', 'displayName'], (result) => {
  if (result.uid && result.appUrl) {
    const name = result.displayName || result.uid.slice(0, 8);
    document.getElementById('status').innerText = 'CONNECTED: ' + name;
  } else {
    document.getElementById('status').innerText = 'NOT CONNECTED';
  }
});
