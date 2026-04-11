document.getElementById('dashboardBtn').addEventListener('click', () => {
  chrome.storage.local.get(['appUrl'], (result) => {
    const url = result.appUrl || 'https://metanoia-stats-dashboard-797861117032.us-west1.run.app';
    chrome.tabs.create({ url });
  });
});

chrome.storage.local.get(['uid', 'appUrl'], (result) => {
  if (result.uid && result.appUrl) {
    document.getElementById('status').innerText = 'CONNECTED: ' + result.uid.slice(0, 8);
  } else {
    document.getElementById('status').innerText = 'NOT CONNECTED';
  }
});
