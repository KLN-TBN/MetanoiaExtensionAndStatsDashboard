// Listen for sync event from the web app
window.addEventListener('METANOIA_SYNC', (event) => {
  const { uid, appUrl } = event.detail;
  chrome.runtime.sendMessage({ type: 'SET_CONFIG', uid, appUrl });
  window.postMessage({ type: 'EXTENSION_CONNECTED' }, '*');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'REQUEST_SYNC') {
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

// --- Constants ---
const SCAN_DELAY = 1000;
const EXCLUDED_DOMAINS = [
  'localhost',
  'ais-dev',
  'ais-pre',
  'chrome.google.com',
  'chrome://',
  'metanoia-stats-dashboard'
];

const MALADY_COLORS = {
  rabbit_hole: '#00f2ff',
  outrage_cycle: '#ff4444',
  echo_chamber: '#00ff00',
  buy_now: '#ff00ff'
};

const MALADY_LABELS = {
  rabbit_hole: 'Rabbit Hole',
  outrage_cycle: 'Outrage Cycle',
  echo_chamber: 'Echo Chamber',
  buy_now: 'Buy Now Reflex'
};

// --- Scan state ---
let scanTimer = null;
let lastScannedText = '';
let isScanning = false;
const processedFlaggedTexts = new Set();

// --- Drawer / badge state ---
let activeMaladyCount = 0;
let badgeEl = null;
let lastScanMaladies = [];
let drawerAutoCloseTimer = null;
let drawerRemainingTime = 8000;
let drawerTimerStart = null;

// --- Scroll cycling state ---
const scrollIndices = {};

// =============================================================
//  SCAN INDICATOR
// =============================================================
let scanIndicatorEl = null;

function setScanIndicator(active) {
  if (!scanIndicatorEl) {
    scanIndicatorEl = document.createElement('div');
    scanIndicatorEl.className = 'metanoia-scan-indicator';
    document.body.appendChild(scanIndicatorEl);
  }
  if (active) {
    scanIndicatorEl.textContent = 'M · SCANNING...';
    scanIndicatorEl.classList.add('visible');
  } else {
    scanIndicatorEl.classList.remove('visible');
  }
}

// =============================================================
//  SUMMARY DRAWER
// =============================================================
function showSummaryDrawer(newlyInjected) {
  // Accumulate across scans — append new maladies to the running list
  lastScanMaladies = [...lastScanMaladies, ...(newlyInjected || [])];

  // Remove any existing drawer and cancel its timer
  const existing = document.getElementById('metanoia-summary');
  if (existing) existing.remove();
  if (drawerAutoCloseTimer) { clearTimeout(drawerAutoCloseTimer); drawerAutoCloseTimer = null; }

  // Derive counts from the live DOM so multi-scan totals are always accurate
  const counts = {};
  document.querySelectorAll('.metanoia-marker[data-malady-type]').forEach(el => {
    const type = el.getAttribute('data-malady-type');
    counts[type] = (counts[type] || 0) + 1;
  });

  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalCount === 0) return;

  const tagsHtml = Object.entries(counts).map(([type, count]) => {
    const color = MALADY_COLORS[type] || '#00f2ff';
    const label = MALADY_LABELS[type] || type;
    return `<span class="metanoia-tag" data-type="${type}" style="border-color:${color};color:${color}">${count > 1 ? count + '× ' : ''}${label}</span>`;
  }).join('');

  const drawer = document.createElement('div');
  drawer.id = 'metanoia-summary';
  drawer.className = 'metanoia-summary';
  drawer.innerHTML = `
    <div class="metanoia-summary-inner">
      <div class="metanoia-summary-header">
        <span class="metanoia-summary-title">M · ${totalCount} THREAT${totalCount > 1 ? 'S' : ''} DETECTED</span>
        <button class="metanoia-summary-close">×</button>
      </div>
      <div class="metanoia-summary-tags">${tagsHtml}</div>
    </div>
    <div class="metanoia-summary-progress"></div>
  `;

  document.body.appendChild(drawer);

  // Animate in after paint
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawer.classList.add('visible');
    drawer.querySelector('.metanoia-summary-progress').classList.add('running');
  }));

  // Tag click → scroll to that malady
  drawer.querySelectorAll('.metanoia-tag[data-type]').forEach(tag => {
    tag.addEventListener('click', () => scrollToMalady(tag.getAttribute('data-type')));
  });

  // Close button → collapse to badge
  drawer.querySelector('.metanoia-summary-close').addEventListener('click', () => {
    clearTimeout(drawerAutoCloseTimer);
    drawerAutoCloseTimer = null;
    collapseDrawerToBadge(drawer);
  });

  // Start auto-dismiss timer
  drawerRemainingTime = 8000;
  drawerTimerStart = Date.now();
  drawerAutoCloseTimer = setTimeout(() => collapseDrawerToBadge(drawer), drawerRemainingTime);
}

function collapseDrawerToBadge(drawer) {
  drawerAutoCloseTimer = null;
  dismissDrawer(drawer);
  if (activeMaladyCount > 0) showBadge();
}

function dismissDrawer(drawer) {
  drawer.classList.remove('visible');
  setTimeout(() => drawer.remove(), 400);
}

// =============================================================
//  VISIBILITY — pause/resume drawer timer when tab is hidden
// =============================================================
document.addEventListener('visibilitychange', () => {
  const drawer = document.getElementById('metanoia-summary');
  if (!drawer) return;

  if (document.hidden) {
    // Pause: cancel timer and freeze the progress bar animation
    if (drawerAutoCloseTimer) {
      clearTimeout(drawerAutoCloseTimer);
      drawerAutoCloseTimer = null;
      drawerRemainingTime = Math.max(0, drawerRemainingTime - (Date.now() - drawerTimerStart));
    }
    const progress = drawer.querySelector('.metanoia-summary-progress');
    if (progress) progress.classList.add('paused');
  } else {
    // Resume: restart timer with whatever time was left
    const progress = drawer.querySelector('.metanoia-summary-progress');
    if (progress) progress.classList.remove('paused');
    drawerTimerStart = Date.now();
    drawerAutoCloseTimer = setTimeout(
      () => collapseDrawerToBadge(drawer),
      Math.max(drawerRemainingTime, 500)
    );
  }
});

// =============================================================
//  PERSISTENT BADGE
// =============================================================
function showBadge() {
  if (badgeEl) { updateBadge(); return; }
  badgeEl = document.createElement('div');
  badgeEl.className = 'metanoia-badge';
  badgeEl.title = 'Click to review threats';
  updateBadgeContent();
  document.body.appendChild(badgeEl);
  requestAnimationFrame(() => requestAnimationFrame(() => badgeEl.classList.add('visible')));

  badgeEl.addEventListener('click', () => {
    removeBadge();
    showSummaryDrawer(); // reads counts from live DOM, no new maladies to append
  });
}

function updateBadgeContent() {
  if (!badgeEl) return;
  badgeEl.textContent = `M · ${activeMaladyCount}`;
}

function updateBadge() {
  if (!badgeEl) return;
  if (activeMaladyCount === 0) {
    removeBadge();
  } else {
    updateBadgeContent();
  }
}

function removeBadge() {
  if (!badgeEl) return;
  badgeEl.classList.remove('visible');
  const el = badgeEl;
  badgeEl = null;
  setTimeout(() => el.remove(), 300);
}

// =============================================================
//  SCROLL TO MALADY
// =============================================================
function scrollToMalady(type) {
  const markers = Array.from(document.querySelectorAll(`.metanoia-marker[data-malady-type="${type}"]`));
  if (markers.length === 0) return;

  if (scrollIndices[type] === undefined) scrollIndices[type] = 0;
  const idx = scrollIndices[type] % markers.length;
  scrollIndices[type] = (idx + 1) % markers.length;

  const target = markers[idx];
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Auto-show popover for the scrolled-to marker
  const popover = target.querySelector('.metanoia-popover');
  if (popover) {
    popover.classList.add('open');
    setTimeout(() => popover.classList.remove('open'), 3000);
  }

  // Flash the dot to confirm which one was jumped to
  const dot = target.querySelector('.metanoia-dot');
  if (dot) {
    dot.classList.remove('flashing');
    void dot.offsetWidth; // force reflow so animation restarts cleanly
    dot.classList.add('flashing');
    setTimeout(() => dot.classList.remove('flashing'), 700);
  }
}

// =============================================================
//  SCAN TIMER
// =============================================================
if (document.readyState === 'complete') {
  startScanTimer();
} else {
  window.addEventListener('load', () => startScanTimer());
}
window.addEventListener('scroll', () => resetTimer());
window.addEventListener('click', () => resetTimer());
window.addEventListener('touchend', () => resetTimer()); // YouTube Shorts swipe

// Detect SPA navigation (YouTube, Reddit, etc.) by watching for URL changes.
// When the URL changes: wipe per-page state and schedule a fresh scan.
let lastObservedUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastObservedUrl) {
    lastObservedUrl = location.href;
    processedFlaggedTexts.clear();
    lastScannedText = '';
    lastScanMaladies = [];
    activeMaladyCount = 0;
    removeBadge();
    startScanTimer();
  }
}).observe(document, { subtree: true, childList: true });

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
  if (EXCLUDED_DOMAINS.some(d => hostname.includes(d)) || pageTitle.includes('METANOIA DASHBOARD')) {
    return;
  }

  const rawText = (() => {
    const buffer = window.innerHeight * 1.5;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const parts = [];
    let el;
    while ((el = walker.nextNode())) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      const rect = el.getBoundingClientRect();
      // rect.width === 0 catches display:none children and zero-size containers
      if (rect.width === 0 || rect.top > window.innerHeight + buffer || rect.bottom < -buffer) continue;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent.trim();
          if (text) parts.push(text);
        }
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').slice(0, 5000);
  })();
  // Normalize numbers only for change-detection — NOT for the API payload,
  // otherwise Gemini returns flaggedText with '#' that can't be found in the DOM.
  const normalizedForComparison = rawText.replace(/\d+/g, '#');

  if (normalizedForComparison === lastScannedText) return;

  isScanning = true;
  lastScannedText = normalizedForComparison;
  setScanIndicator(true);

  // Safety net: if the MV3 service worker callback never fires, clear state after 30s
  let callbackFired = false;
  const safetyTimeout = setTimeout(() => {
    if (!callbackFired) {
      isScanning = false;
      setScanIndicator(false);
      console.warn('[Metanoia Content] Scan timed out — no response from background.');
    }
  }, 30000);

  chrome.runtime.sendMessage({
    type: 'SCAN_PAGE',
    text: rawText,   // real text so flaggedText matches the actual DOM
    url: window.location.href
  }, (response) => {
    callbackFired = true;
    clearTimeout(safetyTimeout);
    isScanning = false;
    setScanIndicator(false);

    if (chrome.runtime.lastError || !response || response.error) {
      console.error('[Metanoia Content] Scan error:', chrome.runtime.lastError || response?.error);
      startScanTimer(); // keep scanning even on error
      return;
    }

    if (response.maladies && response.maladies.length > 0) {
      const injected = [];
      response.maladies.forEach(m => {
        if (!processedFlaggedTexts.has(normKey(m.flaggedText))) {
          if (injectGutterMarker(m)) {
            injected.push(m);
          }
        }
      });
      if (injected.length > 0) {
        showSummaryDrawer(injected);
      }
    }

    // No reschedule — scroll/click listeners and URL observer handle re-scanning
  });
}

// =============================================================
//  GUTTER MARKER INJECTION
// =============================================================
function getBlockAncestor(el) {
  const preferred = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION']);
  const fallbackTags = new Set(['DIV', 'ARTICLE', 'SECTION', 'MAIN', 'ASIDE']);
  let fallback = null;
  let current = el.parentElement;

  while (current && current !== document.body) {
    if (preferred.has(current.tagName)) return current;
    if (!fallback && fallbackTags.has(current.tagName)) fallback = current;
    current = current.parentElement;
  }

  return fallback || el.parentElement || document.body;
}

// Escapes HTML special characters in Gemini-provided strings before injecting into innerHTML.
// Without this, a '<' or '>' in an explanation breaks the entire popover template.
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Normalised key for processedFlaggedTexts — matches the same normalisation used
// in DOM search so Gemini's minor variations don't bypass the dedup check.
function normKey(str) {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Maps a position in a whitespace-normalized string back to the raw string position.
// Used so we can search normalized text but still create a precise DOM Range.
function normToRawIndex(rawStr, normIndex) {
  let normPos = 0;
  let prevWasWS = false;
  for (let i = 0; i <= rawStr.length; i++) {
    if (normPos === normIndex) return i;
    if (i === rawStr.length) break;
    const isWS = /\s/.test(rawStr[i]);
    if (isWS) {
      if (!prevWasWS) normPos++;
      prevWasWS = true;
    } else {
      normPos++;
      prevWasWS = false;
    }
  }
  return rawStr.length;
}

function injectGutterMarker(malady) {
  // Normalize target the same way rawText was normalized before sending to Gemini
  const targetText = malady.flaggedText.toLowerCase().trim().replace(/\s+/g, ' ');
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el) {
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  let injected = false;

  while ((node = walker.nextNode())) {
    // Normalize the node text for comparison
    const nodeNorm = node.textContent.replace(/\s+/g, ' ').toLowerCase();
    const normIndex = nodeNorm.indexOf(targetText);

    if (normIndex !== -1) {
      processedFlaggedTexts.add(normKey(malady.flaggedText));

      // Map normalized indices back to raw positions for the Range
      const rawStart = normToRawIndex(node.textContent, normIndex);
      const rawEnd   = normToRawIndex(node.textContent, normIndex + targetText.length);

      const range = document.createRange();
      range.setStart(node, rawStart);
      range.setEnd(node, rawEnd);

      const highlight = document.createElement('span');
      highlight.className = `metanoia-highlight ${malady.maladyType}`;

      try {
        range.surroundContents(highlight);
      } catch (e) {
        // Range crosses element boundaries — fall through to markerless fallback
        highlight.remove();
        break;
      }

      const block = getBlockAncestor(highlight);
      attachMarker(malady, block, highlight);
      injected = true;
      break;
    }
  }

  if (injected) return true;

  // Fallback: text spans multiple elements (common on Amazon, news sites).
  // Find the block element whose innerText contains the flagged text (normalized),
  // inject the marker there without a text highlight so something always shows.
  if (!processedFlaggedTexts.has(normKey(malady.flaggedText))) {
    const candidates = document.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, div[class], span[class]');
    for (const el of candidates) {
      const elText = (el.innerText || '').replace(/\s+/g, ' ').toLowerCase();
      if (elText.includes(targetText) && elText.length < targetText.length * 8) {
        processedFlaggedTexts.add(normKey(malady.flaggedText));
        attachMarker(malady, el, null); // null = no highlight to unwrap
        return true;
      }
    }
  }

  return false;
}

// Builds and inserts the gutter marker into `block`, wiring up all interactions.
// `highlight` is the wrapping span for the flagged text, or null if unavailable.
function attachMarker(malady, block, highlight) {
  const color = MALADY_COLORS[malady.maladyType] || '#00f2ff';
  const label = esc(malady.title || MALADY_LABELS[malady.maladyType] || malady.maladyType);

  let counterHtml = '';
  if (malady.counterPerspective) {
    counterHtml = `
      <div class="metanoia-counter">
        <div class="metanoia-counter-label">Counter Perspective</div>
        <p>${esc(malady.counterPerspective)}</p>
      </div>
    `;
  }

  let metricHtml = '';
  if (malady.metricValue && malady.metricValue > 0) {
    metricHtml = `<span class="metanoia-metric">+${esc(String(malady.metricValue))}${esc(malady.unit || '')}</span>`;
  }

  const marker = document.createElement('span');
  marker.className = `metanoia-marker ${malady.maladyType}`;
  marker.setAttribute('data-malady-type', malady.maladyType);
  marker.innerHTML = `
    <span class="metanoia-dot" style="background:${color};box-shadow:0 0 6px ${color}">M</span>
    <div class="metanoia-popover" style="border-color:${color};color:#f0f0f0;box-shadow:0 0 20px ${color}33">
      <div class="metanoia-popover-header">
        <span class="metanoia-popover-title" style="color:${color}">${label}</span>
        <button class="metanoia-dismiss" title="Dismiss">×</button>
      </div>
      <p class="metanoia-popover-body" style="color:${color}">${esc(malady.explanation)}</p>
      ${counterHtml}
      <div class="metanoia-popover-footer">
        <div class="metanoia-feedback">
          <button class="metanoia-btn-fb up" style="border-color:${color};color:${color}" title="Helpful">👍</button>
          <button class="metanoia-btn-fb down" style="border-color:${color};color:${color}" title="Not helpful">👎</button>
        </div>
        ${metricHtml}
      </div>
    </div>
  `;

  block.insertBefore(marker, block.firstChild);
  activeMaladyCount++;

  const popover = marker.querySelector('.metanoia-popover');

  // Show on hover, persist until the user clicks ×
  marker.addEventListener('mouseenter', () => {
    if (popover.classList.contains('open')) return; // already open, skip reflow
    popover.style.left = '18px';
    popover.style.right = '';
    popover.classList.add('open');
    const rect = popover.getBoundingClientRect();
    if (rect.right > window.innerWidth - 20) {
      popover.style.left = 'auto';
      popover.style.right = '18px';
    }
  });

  marker.querySelector('.metanoia-dismiss').addEventListener('click', (e) => {
    e.stopPropagation();
    dismissMarker(marker, highlight);
  });

  const upBtn = marker.querySelector('.up');
  const downBtn = marker.querySelector('.down');

  upBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'FEEDBACK', logId: malady.logId, feedback: 'up' });
    upBtn.style.background = color;
    upBtn.style.color = '#050505';
    setTimeout(() => dismissMarker(marker, highlight), 1200);
  });

  downBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'FEEDBACK', logId: malady.logId, feedback: 'down' });
    downBtn.style.background = '#ff4444';
    downBtn.style.borderColor = '#ff4444';
    downBtn.style.color = '#050505';
    setTimeout(() => dismissMarker(marker, highlight), 1200);
  });
}

function dismissMarker(marker, highlight) {
  activeMaladyCount = Math.max(0, activeMaladyCount - 1);
  updateBadge();

  const dot = marker.querySelector('.metanoia-dot');
  if (dot) dot.classList.add('exiting');
  setTimeout(() => {
    marker.remove();
    if (highlight && highlight.parentNode) {
      while (highlight.firstChild) highlight.parentNode.insertBefore(highlight.firstChild, highlight);
      highlight.parentNode.removeChild(highlight);
    }
  }, 300);
}
