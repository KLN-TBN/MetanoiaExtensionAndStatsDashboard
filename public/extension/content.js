// Listen for sync event from the web app
window.addEventListener('METANOIA_SYNC', (event) => {
  const { uid, appUrl } = event.detail;
  chrome.runtime.sendMessage({ type: 'SET_CONFIG', uid, appUrl });
});

// Listen for sync request from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'REQUEST_SYNC') {
    // Dispatch event to the web app to trigger sync
    window.postMessage({ type: 'REQUEST_SYNC' }, '*');
  }

  if (request.type === 'SERVER_LOG') {
    if (request.logType === 'error') {
      console.error(request.message);
    } else {
      console.log(request.message);
    }
  }
});

let scanTimer = null;
let lastScannedText = '';
let isScanning = false;
const processedFlaggedTexts = new Set();

const SCAN_DELAY = 10000; // 10 seconds idle
const EXCLUDED_DOMAINS = [
  'localhost',
  'ais-dev',
  'ais-pre',
  'chrome.google.com',
  'chrome://'
];

// Listen for page load
window.addEventListener('load', () => {
  startScanTimer();
});

// Reset timer on scroll or click (user is active)
window.addEventListener('scroll', () => resetTimer());
window.addEventListener('click', () => resetTimer());

function startScanTimer() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(performScan, SCAN_DELAY);
}

function resetTimer() {
  startScanTimer();
}

async function performScan() {
  if (isScanning) return;

  const hostname = window.location.hostname;
  const pageTitle = document.title.toUpperCase();
  if (EXCLUDED_DOMAINS.some(domain => hostname.includes(domain)) || pageTitle.includes('METANOIA DASHBOARD')) {
    console.log(`[Metanoia Content] Skipping scan for excluded domain or title: ${hostname} / ${pageTitle}`);
    return;
  }

  // Extract visible text - trim and normalize to prevent minor changes from triggering
  // Also remove numbers/dates which change frequently to avoid false "content changed" triggers
  const currentText = document.body.innerText.slice(0, 5000)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d+/g, '#'); 
  
  // Only scan if content has changed significantly
  if (currentText === lastScannedText) {
    console.log('[Metanoia Content] Content unchanged since last scan. Skipping.');
    return;
  }

  isScanning = true;
  console.log('[Metanoia Content] 10s idle reached and content changed. Starting scan...');
  lastScannedText = currentText;
  const url = window.location.href;

  chrome.runtime.sendMessage({ 
    type: 'SCAN_PAGE', 
    text: currentText, 
    url: url 
  }, (response) => {
    isScanning = false;
    if (chrome.runtime.lastError) {
      console.error('[Metanoia Content] Runtime error:', chrome.runtime.lastError);
      return;
    }

    if (response && response.error) {
      console.error(`[Metanoia Content] Scan failed: ${response.error}`);
      return;
    }

    if (response && response.maladies) {
      console.log(`[Metanoia Content] Received ${response.maladies.length} maladies to process.`);
      response.maladies.forEach(m => {
        // Skip if we've already flagged this exact text on this page
        if (processedFlaggedTexts.has(m.flaggedText)) {
          console.log(`[Metanoia Content] Skipping duplicate malady: ${m.flaggedText}`);
          return;
        }
        injectMaladyIcon(m);
      });
    }
  });
}

function injectMaladyIcon(malady) {
  const targetText = malady.flaggedText.toLowerCase().trim();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;

  while (node = walker.nextNode()) {
    const nodeText = node.textContent.toLowerCase();
    const index = nodeText.indexOf(targetText);
    
    if (index !== -1) {
      processedFlaggedTexts.add(malady.flaggedText);

      // Create a range to wrap the text
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + targetText.length);
      
      const highlight = document.createElement('span');
      highlight.className = `metanoia-highlight ${malady.maladyType}`;
      range.surroundContents(highlight);

      const icon = document.createElement('div');
      icon.className = 'metanoia-icon';
      
      // Use specific icons for maladies
      let iconChar = '⚠️';
      if (malady.maladyType === 'rabbit_hole') iconChar = '🕳️';
      if (malady.maladyType === 'outrage_cycle') iconChar = '🔥';
      if (malady.maladyType === 'echo_chamber') iconChar = '📢';
      if (malady.maladyType === 'buy_now') iconChar = '💰';
      
      icon.innerHTML = iconChar;
      
      const tooltip = document.createElement('div');
      tooltip.className = 'metanoia-tooltip';
      
      let metricHtml = '';
      if (malady.metricValue && malady.metricValue > 0) {
        metricHtml = `<span class="metanoia-metric">+${malady.metricValue} ${malady.unit}</span>`;
      }

      let counterHtml = '';
      if (malady.counterPerspective) {
        counterHtml = `
          <div class="metanoia-counter-perspective">
            <div class="metanoia-label">Counter Perspective</div>
            <p>${malady.counterPerspective}</p>
          </div>
        `;
      }

      tooltip.innerHTML = `
        <div class="metanoia-tooltip-content">
          <h4>${malady.title}</h4>
          <p>${malady.explanation}</p>
          ${counterHtml}
          <div class="metanoia-actions">
            <div class="metanoia-feedback">
              <button class="metanoia-btn up" title="Helpful">👍</button>
              <button class="metanoia-btn down" title="Not helpful">👎</button>
            </div>
            ${metricHtml}
          </div>
        </div>
      `;

      // Position logic - place icon relative to the highlight span
      const rect = highlight.getBoundingClientRect();
      let top = window.scrollY + rect.top + (rect.height / 2) - 18;
      let left = window.scrollX + rect.left - 42; // Closer to text

      // Ensure icon doesn't clip off the left edge of the viewport
      if (left < window.scrollX + 10) {
        left = window.scrollX + rect.right + 12;
      }

      // Ensure icon doesn't clip off the top edge of the viewport
      if (top < window.scrollY + 10) {
        top = window.scrollY + 10;
      }
      
      // Ensure icon doesn't clip off the right edge of the viewport
      const viewportWidth = window.innerWidth;
      if (left + 36 > window.scrollX + viewportWidth - 10) {
        left = window.scrollX + viewportWidth - 46;
      }

      icon.style.top = `${top}px`;
      icon.style.left = `${left}px`;

      // Add a connecting line
      const line = document.createElement('div');
      line.className = 'metanoia-connector';
      
      const updateLine = () => {
        const iRect = icon.getBoundingClientRect();
        const hRect = highlight.getBoundingClientRect();
        
        const x1 = iRect.left + iRect.width / 2;
        const y1 = iRect.top + iRect.height / 2;
        const x2 = hRect.left + hRect.width / 2;
        const y2 = hRect.top + hRect.height / 2;
        
        const length = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
        const angle = Math.atan2(y2-y1, x2-x1) * 180 / Math.PI;
        
        line.style.width = `${length}px`;
        line.style.transform = `rotate(${angle}deg)`;
        line.style.top = `${y1 + window.scrollY}px`;
        line.style.left = `${x1 + window.scrollX}px`;
      };

      // Add tooltip to icon so it stays when hovering over tooltip
      icon.appendChild(tooltip);

      // Feedback listeners
      const upBtn = tooltip.querySelector('.up');
      const downBtn = tooltip.querySelector('.down');

      const cleanup = () => {
        icon.remove();
        line.remove();
        // Unwrap highlight but keep text
        const parent = highlight.parentNode;
        if (parent) {
          while(highlight.firstChild) parent.insertBefore(highlight.firstChild, highlight);
          parent.removeChild(highlight);
        }
      };

      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'FEEDBACK', logId: malady.logId, feedback: 'up' });
        upBtn.classList.add('selected');
        downBtn.classList.remove('selected');
        highlight.classList.add('active');
        setTimeout(cleanup, 1500);
      });

      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'FEEDBACK', logId: malady.logId, feedback: 'down' });
        downBtn.classList.add('selected');
        upBtn.classList.remove('selected');
        highlight.classList.add('active');
        setTimeout(cleanup, 1500);
      });

      document.body.appendChild(icon);
      document.body.appendChild(line);
      updateLine();
      
      // Update line on scroll/resize
      window.addEventListener('scroll', updateLine, { passive: true });
      window.addEventListener('resize', updateLine, { passive: true });

      break; 
    }
  }
}
