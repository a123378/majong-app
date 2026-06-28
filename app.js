/**
 * 麻將個人戰績統計 PWA - Core Logic (每日戰績與細部分析升級版)
 * Fully client-side reactive state manager with LocalStorage persistence.
 */

// --- 1. Service Worker Registration for PWA with Update Detection ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registered successfully:', reg.scope);
        
        // Check if there is already a waiting worker from a previous page load
        if (reg.waiting) {
          showUpdatePrompt(reg.waiting);
        }
        
        // Listen for new service worker installation cycles
        reg.addEventListener('updatefound', () => {
          const installingWorker = reg.installing;
          if (installingWorker) {
            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // A fresh service worker is installed and waiting to take over
                showUpdatePrompt(installingWorker);
              }
            });
          }
        });
      })
      .catch((err) => console.error('[PWA] Service Worker registration failed:', err));
      
    // Reactive window reloading once a new controller is active
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        window.location.reload();
        refreshing = true;
      }
    });
  });
}

// Display top floating non-disruptive version update prompt banner
function showUpdatePrompt(waitingWorker) {
  const banner = document.getElementById('updateBanner');
  const btnReload = document.getElementById('btnReloadUpdate');
  
  if (!banner || !btnReload) return;
  
  btnReload.addEventListener('click', () => {
    // Clear all legacy caches completely to guarantee fresh assets are loaded
    caches.keys().then((names) => {
      return Promise.all(names.map(name => caches.delete(name)));
    }).then(() => {
      // Prompt waiting worker to skipWaiting and activate
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      banner.classList.remove('active');
    }).catch((err) => {
      console.error('Failed to clear caches on update:', err);
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });
  });
  
  // Animate banner slide down from top
  banner.classList.add('active');
}

// --- 1.5. PWA Installation Prompt Logic ---
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  // Update UI to notify the user they can install the PWA
  if (el.btnInstallPWA) {
    el.btnInstallPWA.classList.remove('hidden');
  }
});

window.addEventListener('appinstalled', (evt) => {
  console.log('[PWA] Installed successfully');
  showToast('🎉 感謝安裝！已成功加入桌面');
  if (el.btnInstallPWA) {
    el.btnInstallPWA.classList.add('hidden');
  }
});

// --- 2. Application State & Storage Schema ---
const STORAGE_KEY = 'mahjong_pwa_state_v2'; // Bumped version to support nested history schema

let state = {
  settings: {
    base: 300,
    point: 100
  },
  historyByDate: {}, // Nested Map schema: 'YYYY-MM-DD': Array of { id, matchId, type, points, amount, timestamp, pattern }
  activeMatchId: null
};

// --- 2.5. Local Time Helper ---
/**
 * Get date string (YYYY-MM-DD) in the user's local timezone.
 * @param {number} timestamp - Timestamp milliseconds
 * @returns {string} Date string YYYY-MM-DD
 */
function getLocalDateString(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

// --- 3. Temporary Session State ---
let activeActionType = 'self-drawn'; // self-drawn, win-card, discard, passive-drawn
let currentPointsInput = '0';
let pendingBigHandItem = null;
let activeDetailDate = null; // Track which date details sheet is currently viewing

// --- 4. DOM Elements ---
const el = {
  // Settings Summary Display
  summaryBaseDisplay: document.getElementById('summaryBaseDisplay'),
  summaryPointDisplay: document.getElementById('summaryPointDisplay'),
  
  // Home Dashboard displays
  totalProfitDisplay: document.getElementById('totalProfitDisplay'),
  totalHandsCount: document.getElementById('totalHandsCount'),
  todaySelfDrawnCount: document.getElementById('todaySelfDrawnCount'),
  todayWinCount: document.getElementById('todayWinCount'),
  todayDiscardCount: document.getElementById('todayDiscardCount'),
  todayPassiveDrawnCount: document.getElementById('todayPassiveDrawnCount'),
  rateSelfDrawn: document.getElementById('rateSelfDrawn'),
  rateWin: document.getElementById('rateWin'),
  rateDiscard: document.getElementById('rateDiscard'),
  
  // Core operational buttons
  btnSelfDrawn: document.getElementById('btnSelfDrawn'),
  btnWin: document.getElementById('btnWin'),
  btnDiscard: document.getElementById('btnDiscard'),
  btnPassiveDrawn: document.getElementById('btnPassiveDrawn'),
  btnDraw: document.getElementById('btnDraw'),
  
  // Settings Modal Sheet
  settingsModal: document.getElementById('settingsModal'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  inputBase: document.getElementById('inputBase'),
  inputPoint: document.getElementById('inputPoint'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),
  btnResetAll: document.getElementById('btnResetAll'),
  btnInstallPWA: document.getElementById('btnInstallPWA'),
  settingsPresets: document.getElementById('settingsPresets'),
  
  // Keypad Modal Overlay
  keypadModal: document.getElementById('keypadModal'),
  closeKeypadBtn: document.getElementById('closeKeypadBtn'),
  keypadTitle: document.getElementById('keypadTitle'),
  keypadPointsDisplay: document.getElementById('keypadPointsDisplay'),
  keypadAmountPreview: document.getElementById('keypadAmountPreview'),
  keypadPresets: document.getElementById('keypadPresets'),
  kpDeleteKey: document.getElementById('kpDeleteKey'),
  kpConfirmKey: document.getElementById('kpConfirmKey'),
  
  // Daily Summary panel
  historyList: document.getElementById('historyList'),
  historyEmptyState: document.getElementById('historyEmptyState'),
  
  // Big Hand Modal Overlay
  bigHandModal: document.getElementById('bigHandModal'),
  closeBigHandBtn: document.getElementById('closeBigHandBtn'),
  bigHandPresets: document.getElementById('bigHandPresets'),
  inputCustomHand: document.getElementById('inputCustomHand'),
  btnSkipBigHand: document.getElementById('btnSkipBigHand'),
  btnConfirmBigHand: document.getElementById('btnConfirmBigHand'),
  
  // Daily Details Page (Slide-Over Panel)
  detailsPage: document.getElementById('detailsPage'),
  btnBackToHome: document.getElementById('btnBackToHome'),
  detailsPageTitle: document.getElementById('detailsPageTitle'),
  dayProfitDisplay: document.getElementById('dayProfitDisplay'),
  daySelfDrawnRateDisplay: document.getElementById('daySelfDrawnRateDisplay'),
  dayWinRateDisplay: document.getElementById('dayWinRateDisplay'),
  dayDiscardRateDisplay: document.getElementById('dayDiscardRateDisplay'),
  dayTotalHands: document.getElementById('dayTotalHands'),
  daySelfDrawnCount: document.getElementById('daySelfDrawnCount'),
  dayWinCount: document.getElementById('dayWinCount'),
  dayDiscardCount: document.getElementById('dayDiscardCount'),
  dayHistoryList: document.getElementById('dayHistoryList'),
  
  // Toast notifications
  toastAlert: document.getElementById('toastAlert'),
  toastIcon: document.getElementById('toastIcon'),
  toastMessage: document.getElementById('toastMessage')
};

// --- 5. Initialization ---
function init() {
  loadStateFromStorage();
  renderAll();
  setupEventListeners();
  
  // Prevent default double-tap-to-zoom on iOS for buttons
  const buttons = document.querySelectorAll('button, .kp-btn, .op-btn, .preset-btn');
  buttons.forEach(btn => {
    btn.addEventListener('touchstart', (e) => {
      // Allow default clicks but prevent standard double-tap zoom
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: true });
  });
}

// Load state from LocalStorage with smart backward-compatible migration
function loadStateFromStorage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  
  // Check if old storage scheme version 1 exists to perform legacy migration
  const storedV1 = localStorage.getItem('mahjong_pwa_state_v1');
  
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed) {
        state.settings = parsed.settings || state.settings;
        state.historyByDate = parsed.historyByDate || {};
        state.activeMatchId = parsed.activeMatchId || null;
      }
    } catch (e) {
      console.error('Failed to parse storage key state:', e);
    }
  } else if (storedV1) {
    // Perform dynamic data structures migration
    try {
      const parsedV1 = JSON.parse(storedV1);
      if (parsedV1) {
        state.settings = parsedV1.settings || state.settings;
        
        // Migrate old flat array history into dates grouped map
        if (Array.isArray(parsedV1.history)) {
          parsedV1.history.forEach(item => {
            const dateStr = getLocalDateString(item.timestamp || Date.now());
            if (!state.historyByDate[dateStr]) {
              state.historyByDate[dateStr] = [];
            }
            // Ensure every item contains timestamp
            if (!item.timestamp) {
              item.timestamp = Date.now();
            }
            state.historyByDate[dateStr].push(item);
          });
        }
        
        // Save the newly migrated structure under STORAGE_KEY
        saveStateToStorage();
        console.log('[Migration] Successfully migrated legacy data into YYYY-MM-DD grouping.');
      }
    } catch (e) {
      console.error('Failed to migrate legacy v1 data state:', e);
    }
  }

  // Backwards compatibility: ensure all existing records have a matchId
  Object.keys(state.historyByDate).forEach(date => {
    state.historyByDate[date].forEach(item => {
      if (!item.matchId) {
        item.matchId = 'match_legacy_' + date;
      }
    });
  });

  // Ensure activeMatchId is initialized
  if (!state.activeMatchId) {
    state.activeMatchId = 'match_' + Date.now();
    saveStateToStorage();
  }
}

// Save state to LocalStorage
function saveStateToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// --- 6. Math Logic & Calculations ---
/**
 * Calculate profit/loss based on formulas
 * @param {string} type - Action type
 * @param {number} points - Points (台數)
 * @returns {number} Calculated value
 */
function calculateAmount(type, points) {
  const base = state.settings.base;
  const pointVal = state.settings.point;
  const handValue = base + (points * pointVal);
  
  switch (type) {
    case 'self-drawn': // 自摸: 贏 (底 + 台 × 台數) × 3
      return handValue * 3;
    case 'win-card':   // 胡牌: 贏 (底 + 台 × 台數)
      return handValue;
    case 'discard':    // 放槍: 輸 -(底 + 台 × 台數)
      return -handValue;
    case 'passive-drawn': // 被自摸: 輸 -(底 + 台 × 台數)
      return -handValue;
    case 'draw':       // 流局沒事: 0
      return 0;
    default:
      return 0;
  }
}

// --- 7. View Render Engine ---
function renderAll() {
  renderSettings();
  renderDashboard();
  renderDailySummary();
}

// Update settings values displayed
function renderSettings() {
  el.summaryBaseDisplay.textContent = `$${state.settings.base}`;
  el.summaryPointDisplay.textContent = `$${state.settings.point}`;
  
  // Set default values inside modal input fields
  el.inputBase.value = state.settings.base;
  el.inputPoint.value = state.settings.point;
}

// Update current active match's summary stats & profit
function renderDashboard() {
  // Find all records for the active match across all dates
  let activeRecords = [];
  Object.keys(state.historyByDate).forEach(date => {
    const records = state.historyByDate[date] || [];
    records.forEach(item => {
      if (item.matchId === state.activeMatchId) {
        activeRecords.push(item);
      }
    });
  });
  
  let matchProfit = 0;
  let selfDrawnCount = 0;
  let winCount = 0;
  let discardCount = 0;
  let passiveDrawnCount = 0;
  
  activeRecords.forEach(item => {
    matchProfit += item.amount;
    if (item.type === 'self-drawn') selfDrawnCount++;
    else if (item.type === 'win-card') winCount++;
    else if (item.type === 'discard') discardCount++;
    else if (item.type === 'passive-drawn') passiveDrawnCount++;
  });
  
  // Render match's profit with format
  const formattedProfit = (matchProfit >= 0 ? '+' : '-') + '$' + Math.abs(matchProfit).toLocaleString();
  el.totalProfitDisplay.textContent = formattedProfit;
  
  // Style according to positive/negative values
  el.totalProfitDisplay.className = 'dashboard-profit';
  if (matchProfit > 0) {
    el.totalProfitDisplay.classList.add('positive');
  } else if (matchProfit < 0) {
    el.totalProfitDisplay.classList.add('negative');
  } else {
    el.totalProfitDisplay.classList.add('zero');
    el.totalProfitDisplay.textContent = '$0';
  }
  
  // Set supplementary metrics for the match
  const matchHands = activeRecords.length;
  el.totalHandsCount.textContent = `${matchHands} 局`;
  el.todaySelfDrawnCount.textContent = selfDrawnCount;
  el.todayWinCount.textContent = winCount;
  el.todayDiscardCount.textContent = discardCount;
  el.todayPassiveDrawnCount.textContent = passiveDrawnCount;
  
  // Calculate percentage rates relative to match's total hands (Win rate includes both self-drawn and win-card)
  const selfDrawnRate = matchHands > 0 ? Math.round((selfDrawnCount / matchHands) * 100) : 0;
  const winRate = matchHands > 0 ? Math.round(((selfDrawnCount + winCount) / matchHands) * 100) : 0;
  const discardRate = matchHands > 0 ? Math.round((discardCount / matchHands) * 100) : 0;
  
  el.rateSelfDrawn.textContent = `${selfDrawnRate}%`;
  el.rateWin.textContent = `${winRate}%`;
  el.rateDiscard.textContent = `${discardRate}%`;
}

// Render dynamic list of daily summaries
function renderDailySummary() {
  // Clear previous cards, keeping only empty state
  const cards = el.historyList.querySelectorAll('.daily-summary-card');
  cards.forEach(card => card.remove());
  
  const dates = Object.keys(state.historyByDate || {}).sort((a, b) => b.localeCompare(a));
  
  if (dates.length === 0) {
    el.historyEmptyState.classList.remove('hidden');
    return;
  }
  
  el.historyEmptyState.classList.add('hidden');
  
  dates.forEach(date => {
    const records = state.historyByDate[date] || [];
    let dailyProfit = 0;
    
    records.forEach(item => {
      dailyProfit += item.amount;
    });
    
    const card = document.createElement('div');
    card.className = 'daily-summary-card';
    
    // Profit styling
    let profitClass = 'neutral';
    let profitText = '$0';
    if (dailyProfit > 0) {
      profitClass = 'win';
      profitText = `贏 $${dailyProfit.toLocaleString()}`;
    } else if (dailyProfit < 0) {
      profitClass = 'lose';
      profitText = `輸 $${Math.abs(dailyProfit).toLocaleString()}`;
    }
    
    card.innerHTML = `
      <div class="ds-left">
        <span class="ds-calendar-icon">📅</span>
        <span class="ds-date">${date}</span>
      </div>
      <div class="ds-right">
        <span class="ds-profit ${profitClass}">${profitText}</span>
        <span class="ds-games-count">${records.length} 局</span>
        <span class="ds-arrow">❯</span>
      </div>
    `;
    
    // Add navigation click listener
    card.addEventListener('click', () => {
      openDailyDetailsPage(date);
    });
    
    el.historyList.appendChild(card);
  });
}

// --- 7.5. Detailed Daily Analytics Page Controllers ---
function openDailyDetailsPage(date) {
  activeDetailDate = date;
  renderDailyDetailsPage(date);
  
  // Transition slide-over panel in
  el.detailsPage.classList.add('active');
}

function closeDailyDetailsPage() {
  el.detailsPage.classList.remove('active');
  activeDetailDate = null;
}

function renderDailyDetailsPage(date) {
  const records = state.historyByDate[date] || [];
  
  // Header date display
  el.detailsPageTitle.textContent = `📅 ${date} 戰績詳情`;
  
  let dayProfit = 0;
  let selfDrawnCount = 0;
  let winCount = 0;
  let discardCount = 0;
  let passiveDrawnCount = 0;
  
  records.forEach(item => {
    dayProfit += item.amount;
    if (item.type === 'self-drawn') selfDrawnCount++;
    else if (item.type === 'win-card') winCount++;
    else if (item.type === 'discard') discardCount++;
    else if (item.type === 'passive-drawn') passiveDrawnCount++;
  });
  
  const totalHands = records.length;
  // Calculate percentage rates for the selected date (Win rate includes both self-drawn and win-card)
  const selfDrawnRate = totalHands > 0 ? Math.round((selfDrawnCount / totalHands) * 100) : 0;
  const winRate = totalHands > 0 ? Math.round(((selfDrawnCount + winCount) / totalHands) * 100) : 0;
  const discardRate = totalHands > 0 ? Math.round((discardCount / totalHands) * 100) : 0;
  
  // Display stats values
  const formattedProfit = (dayProfit >= 0 ? '+' : '-') + '$' + Math.abs(dayProfit).toLocaleString();
  el.dayProfitDisplay.textContent = formattedProfit;
  el.dayProfitDisplay.className = 'd-stats-profit';
  if (dayProfit > 0) {
    el.dayProfitDisplay.classList.add('win');
  } else if (dayProfit < 0) {
    el.dayProfitDisplay.classList.add('lose');
  } else {
    el.dayProfitDisplay.classList.add('zero');
    el.dayProfitDisplay.textContent = '$0';
  }
  
  el.daySelfDrawnRateDisplay.textContent = `${selfDrawnRate}%`;
  el.dayWinRateDisplay.textContent = `${winRate}%`;
  el.dayDiscardRateDisplay.textContent = `${discardRate}%`;
  el.dayTotalHands.textContent = `${totalHands} 局`;
  el.daySelfDrawnCount.textContent = selfDrawnCount;
  el.dayWinCount.textContent = winCount;
  el.dayDiscardCount.textContent = discardCount;
  
  // Render Day History List grouped by Match
  el.dayHistoryList.innerHTML = '';
  
  // Group records by matchId
  const matchesMap = {};
  const matchIdsInOrder = [];
  
  records.forEach(item => {
    const mId = item.matchId || 'default';
    if (!matchesMap[mId]) {
      matchesMap[mId] = [];
      matchIdsInOrder.push(mId);
    }
    matchesMap[mId].push(item);
  });
  
  // Render each match from newest to oldest
  const reversedMatchIds = [...matchIdsInOrder].reverse();
  
  reversedMatchIds.forEach((mId, matchIndex) => {
    const matchRecords = matchesMap[mId];
    const matchNumber = matchIdsInOrder.indexOf(mId) + 1;
    
    // Calculate match profit
    let matchProfit = 0;
    matchRecords.forEach(r => matchProfit += r.amount);
    const matchProfitText = (matchProfit >= 0 ? '+' : '-') + '$' + Math.abs(matchProfit).toLocaleString();
    const matchProfitClass = matchProfit > 0 ? 'win' : (matchProfit < 0 ? 'lose' : 'neutral');
    
    const matchSection = document.createElement('div');
    matchSection.className = 'match-section';
    
    const matchHeader = document.createElement('div');
    matchHeader.className = 'match-header';
    
    matchHeader.innerHTML = `
      <span class="match-title">第 ${matchNumber} 場 (${matchRecords.length} 局)</span>
      <span class="match-profit ${matchProfitClass}">${matchProfitText}</span>
    `;
    
    matchSection.appendChild(matchHeader);
    
    // Render records within this match (newest on top)
    const reversedRecords = [...matchRecords].reverse();
    reversedRecords.forEach(item => {
      const originalIndex = matchRecords.indexOf(item);
      const roundNumber = originalIndex + 1;
      
      const card = document.createElement('div');
      card.className = 'history-card';
      card.id = `history-card-${item.id}`;
      card.style.background = 'rgba(255, 255, 255, 0.01)';
      card.style.margin = '6px 0';
      
      let tagClass = '';
      let tagText = '';
      let amountClass = '';
      let amountPrefix = '';
      
      switch (item.type) {
        case 'self-drawn':
          tagClass = 'self-drawn';
          tagText = '自摸';
          amountClass = 'win';
          amountPrefix = '+$';
          break;
        case 'win-card':
          tagClass = 'win-card';
          tagText = '胡牌';
          amountClass = 'win';
          amountPrefix = '+$';
          break;
        case 'discard':
          tagClass = 'discard';
          tagText = '放槍';
          amountClass = 'lose';
          amountPrefix = '-$';
          break;
        case 'passive-drawn':
          tagClass = 'passive-drawn';
          tagText = '被自摸';
          amountClass = 'lose';
          amountPrefix = '-$';
          break;
        case 'draw':
          tagClass = 'draw';
          tagText = '流局';
          amountClass = 'neutral';
          amountPrefix = '';
          break;
      }
      
      let patternHtml = '';
      if (item.pattern) {
        patternHtml = ` <span class="h-pattern-text">(${item.pattern})</span>`;
      }
      
      card.innerHTML = `
        <div class="h-info">
          <span class="h-round">第 ${roundNumber} 局</span>
          <div class="h-details">
            <span class="h-tag ${tagClass}">${tagText}</span>
            <span class="h-points">${item.points} 台${patternHtml}</span>
          </div>
        </div>
        <div class="h-amount ${amountClass}">${amountPrefix}${Math.abs(item.amount).toLocaleString()}</div>
        <button class="delete-btn" aria-label="刪除此局紀錄">復原</button>
      `;
      
      card.querySelector('.delete-btn').addEventListener('click', () => {
        deleteDailyHistoryItem(date, item.id);
      });
      
      matchSection.appendChild(card);
    });
    
    el.dayHistoryList.appendChild(matchSection);
  });
}

// Delete / Undo specific history card from selected date array
function deleteDailyHistoryItem(date, id) {
  const cardElement = document.getElementById(`history-card-${id}`);
  if (!cardElement) return;
  
  const records = state.historyByDate[date] || [];
  const itemIndex = records.findIndex(item => item.id === id);
  if (itemIndex === -1) return;
  
  const item = records[itemIndex];
  let typeLabel = '';
  switch (item.type) {
    case 'self-drawn': typeLabel = '自摸'; break;
    case 'win-card': typeLabel = '胡牌'; break;
    case 'discard': typeLabel = '放槍'; break;
    case 'passive-drawn': typeLabel = '被自摸'; break;
    case 'draw': typeLabel = '流局沒事'; break;
  }
  
  cardElement.classList.add('deleting');
  
  setTimeout(() => {
    records.splice(itemIndex, 1);
    
    // If no records left for that date, delete from state structure completely and close detail view
    if (records.length === 0) {
      delete state.historyByDate[date];
      closeDailyDetailsPage();
      showToast(`🔄 已復原此日最後一局，該日歷史紀錄已清空！`);
    } else {
      showToast(`🔄 已復原刪除: 當日第 ${itemIndex + 1} 局 ${typeLabel} 紀錄`);
      renderDailyDetailsPage(date);
    }
    
    saveStateToStorage();
    renderAll();
  }, 300);
}

// --- 8. Core Event Controllers ---

// Open Keypad modal sheet for operations
function openKeypad(type) {
  activeActionType = type;
  currentPointsInput = '0';
  
  // Set Title Text
  let title = '';
  switch (type) {
    case 'self-drawn': title = '🀄 自摸 - 請輸入台數'; break;
    case 'win-card': title = '🎉 胡牌 - 請輸入台數'; break;
    case 'discard': title = '⚡ 放槍 - 請輸入台數'; break;
    case 'passive-drawn': title = '💸 被自摸 - 請輸入台數'; break;
  }
  el.keypadTitle.textContent = title;
  
  // Update rendering and active classes
  updateKeypadPreview();
  
  el.keypadModal.classList.add('active');
}

// Close Keypad modal sheet
function closeKeypad() {
  el.keypadModal.classList.remove('active');
}

// Update Keypad screen calculations preview
function updateKeypadPreview() {
  const points = parseInt(currentPointsInput) || 0;
  el.keypadPointsDisplay.textContent = `${points} 台`;
  
  const amount = calculateAmount(activeActionType, points);
  
  const formatted = (amount >= 0 ? '+' : '-') + '$' + Math.abs(amount).toLocaleString();
  el.keypadAmountPreview.textContent = formatted;
  
  // Color configuration
  el.keypadAmountPreview.style.color = amount >= 0 ? 'var(--color-profit)' : 'var(--color-loss)';
}

// Handle keypad numeric click
function handleKeypadNumber(numStr) {
  if (currentPointsInput === '0') {
    currentPointsInput = numStr;
  } else {
    // Max 2 digits (e.g. 99台 is the absolute max)
    if (currentPointsInput.length < 2) {
      currentPointsInput += numStr;
    }
  }
  updateKeypadPreview();
}

// Handle keypad backspace action
function handleKeypadDelete() {
  if (currentPointsInput.length > 1) {
    currentPointsInput = currentPointsInput.slice(0, -1);
  } else {
    currentPointsInput = '0';
  }
  updateKeypadPreview();
}

// Confirm action from custom Keypad
function confirmKeypadSelection() {
  const points = parseInt(currentPointsInput) || 0;
  
  // Check validity
  if (points < 0) {
    showToast('❌ 台數不可小於 0！', 'error');
    return;
  }
  
  const amount = calculateAmount(activeActionType, points);
  
  // Create temporary history item
  const newItem = {
    id: 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    matchId: state.activeMatchId,
    type: activeActionType,
    points: points,
    amount: amount,
    timestamp: Date.now(),
    pattern: ''
  };
  
  // Trigger Condition: 自摸 (self-drawn) & points >= 5 (大於 4 台)
  if (activeActionType === 'self-drawn' && points >= 5) {
    pendingBigHandItem = newItem;
    
    // Reset big hand modal states
    const presets = el.bigHandPresets.querySelectorAll('.hand-type-preset');
    presets.forEach(p => p.classList.remove('selected'));
    el.inputCustomHand.value = '';
    
    closeKeypad();
    openBigHand();
    return;
  }
  
  saveDirectRecord(newItem);
  closeKeypad();
}

// Save regular records
function saveDirectRecord(item) {
  const todayStr = getLocalDateString(item.timestamp);
  
  if (!state.historyByDate[todayStr]) {
    state.historyByDate[todayStr] = [];
  }
  state.historyByDate[todayStr].push(item);
  saveStateToStorage();
  
  renderAll();
  
  // If Details Page is open and displaying today, re-render it dynamically too
  if (activeDetailDate === todayStr) {
    renderDailyDetailsPage(todayStr);
  }
  
  let actionLabel = '';
  let emoji = '';
  switch (item.type) {
    case 'self-drawn': actionLabel = '自摸'; emoji = '🀄'; break;
    case 'win-card': actionLabel = '胡牌'; emoji = '🎉'; break;
    case 'discard': actionLabel = '放槍'; emoji = '🔫'; break;
    case 'passive-drawn': actionLabel = '被自摸'; emoji = '💸'; break;
    case 'draw': actionLabel = '流局沒事'; emoji = '🤝'; break;
  }
  
  // Count match hands
  let matchHands = 0;
  Object.keys(state.historyByDate).forEach(date => {
    state.historyByDate[date].forEach(r => {
      if (r.matchId === state.activeMatchId) {
        matchHands++;
      }
    });
  });
  
  let toastMsg = '';
  if (item.type === 'draw') {
    toastMsg = `${emoji} 已記錄本場第 ${matchHands} 局: ${actionLabel}`;
  } else {
    const sign = item.amount >= 0 ? '贏' : '輸';
    toastMsg = `${emoji} 已記錄本場第 ${matchHands} 局: ${actionLabel} ${item.points} 台 (${sign} $${Math.abs(item.amount).toLocaleString()})`;
  }
  
  showToast(toastMsg);
}

// Immediately record a draw round (no event)
function recordDrawRound() {
  const newItem = {
    id: 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    matchId: state.activeMatchId,
    type: 'draw',
    points: 0,
    amount: 0,
    timestamp: Date.now(),
    pattern: ''
  };
  saveDirectRecord(newItem);
}

// --- 8.5. Big Hand Modal Controllers ---
function openBigHand() {
  el.bigHandModal.classList.add('active');
}

function closeBigHand() {
  el.bigHandModal.classList.remove('active');
  pendingBigHandItem = null;
}

// Record with chosen/custom pattern
function confirmBigHandRecord() {
  if (!pendingBigHandItem) return;
  
  const selectedPreset = el.bigHandPresets.querySelector('.hand-type-preset.selected');
  const presetVal = selectedPreset ? selectedPreset.getAttribute('data-value') : '';
  const customVal = el.inputCustomHand.value.trim();
  
  let finalPattern = '';
  if (presetVal && customVal) {
    finalPattern = `${presetVal} + ${customVal}`;
  } else {
    finalPattern = presetVal || customVal;
  }
  
  pendingBigHandItem.pattern = finalPattern;
  
  const todayStr = getLocalDateString(pendingBigHandItem.timestamp);
  if (!state.historyByDate[todayStr]) {
    state.historyByDate[todayStr] = [];
  }
  state.historyByDate[todayStr].push(pendingBigHandItem);
  saveStateToStorage();
  
  renderAll();
  
  // If details sheet is viewing today, re-render dynamically
  if (activeDetailDate === todayStr) {
    renderDailyDetailsPage(todayStr);
  }
  
  const sign = pendingBigHandItem.amount >= 0 ? '贏' : '輸';
  const patternNote = finalPattern ? ` (${finalPattern})` : '';
  
  // Count match hands
  let matchHands = 0;
  Object.keys(state.historyByDate).forEach(date => {
    state.historyByDate[date].forEach(r => {
      if (r.matchId === state.activeMatchId) {
        matchHands++;
      }
    });
  });
  
  showToast(`🀄 已記錄本場第 ${matchHands} 局: 自摸 ${pendingBigHandItem.points} 台${patternNote} (贏 $${Math.abs(pendingBigHandItem.amount).toLocaleString()})`);
  
  closeBigHand();
}

// Skip pattern entry
function skipBigHandRecord() {
  if (!pendingBigHandItem) return;
  
  // Explicitly clear pattern
  pendingBigHandItem.pattern = '';
  
  saveDirectRecord(pendingBigHandItem);
  closeBigHand();
}

// Open settings overlay sheet
function openSettings() {
  const currentBase = state.settings.base;
  const currentPoint = state.settings.point;
  
  // Restore manual inputs B and P values
  el.inputBase.value = currentBase;
  el.inputPoint.value = currentPoint;
  
  // Clean prior selections
  const cards = el.settingsPresets.querySelectorAll('.settings-preset-card');
  cards.forEach(card => card.classList.remove('selected'));
  
  // Check if current settings match one of the presets
  cards.forEach(card => {
    const b = parseInt(card.getAttribute('data-base'));
    const p = parseInt(card.getAttribute('data-point'));
    if (b === currentBase && p === currentPoint) {
      card.classList.add('selected');
    }
  });
  
  el.settingsModal.classList.add('active');
}

// Close settings overlay sheet
function closeSettings() {
  el.settingsModal.classList.remove('active');
}

// Save adjusted settings values
function saveSettings() {
  const base = parseInt(el.inputBase.value);
  const pointVal = parseInt(el.inputPoint.value);
  
  if (isNaN(base) || base < 0) {
    showToast('❌ 底價金額不合法', 'error');
    return;
  }
  
  if (isNaN(pointVal) || pointVal < 0) {
    showToast('❌ 台價金額不合法', 'error');
    return;
  }
  
  state.settings.base = base;
  state.settings.point = pointVal;
  
  // If settings changed, recalculate the absolute values for every single record in all dates
  Object.keys(state.historyByDate).forEach(date => {
    state.historyByDate[date] = state.historyByDate[date].map(item => {
      return {
        ...item,
        amount: calculateAmount(item.type, item.points)
      };
    });
  });
  
  saveStateToStorage();
  renderAll();
  
  // Re-render open detail sheet if applicable
  if (activeDetailDate) {
    renderDailyDetailsPage(activeDetailDate);
  }
  
  showToast('⚙️ 已更新本雀底台設定與盈虧金額！');
  closeSettings();
}

// Complete current session and start a new match
function resetSession() {
  if (confirm('🏁 確定要結束本場並開始新的一場嗎？\n此動作將會結算本場數據並重置主畫面，已記錄的數據會保存在歷史紀錄中。')) {
    // Generate a new activeMatchId to start a new match session
    state.activeMatchId = 'match_' + Date.now();
    saveStateToStorage();
    renderAll();
    
    // Close details sheet if open
    closeDailyDetailsPage();
    
    showToast('🏁 本場已結算，全新的一場已開始！');
    closeSettings();
  }
}

// --- 9. Toast Notification Handler ---
let toastTimeout;
function showToast(message, type = 'success') {
  clearTimeout(toastTimeout);
  
  el.toastMessage.textContent = message;
  
  if (type === 'error') {
    el.toastIcon.textContent = '❌';
    el.toastAlert.style.borderColor = 'var(--color-loss)';
  } else {
    el.toastIcon.textContent = '✨';
    el.toastAlert.style.borderColor = 'var(--color-accent)';
  }
  
  el.toastAlert.classList.add('active');
  
  toastTimeout = setTimeout(() => {
    el.toastAlert.classList.remove('active');
  }, 2500);
}

// --- 10. Event Listener Setup ---
function setupEventListeners() {
  // Opening operation modals
  el.btnSelfDrawn.addEventListener('click', () => openKeypad('self-drawn'));
  el.btnWin.addEventListener('click', () => openKeypad('win-card'));
  el.btnDiscard.addEventListener('click', () => openKeypad('discard'));
  el.btnPassiveDrawn.addEventListener('click', () => openKeypad('passive-drawn'));
  el.btnDraw.addEventListener('click', recordDrawRound);
  
  // Keypad controls
  el.closeKeypadBtn.addEventListener('click', closeKeypad);
  
  // Preset buttons
  const presetBtns = el.keypadPresets.querySelectorAll('.preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentPointsInput = btn.getAttribute('data-value');
      updateKeypadPreview();
    });
  });
  
  // Numeric grid keys
  const keys = el.keypadModal.querySelectorAll('.kp-btn.num-key');
  keys.forEach(key => {
    key.addEventListener('click', () => {
      handleKeypadNumber(key.textContent.trim());
    });
  });
  
  // Backspace key
  el.kpDeleteKey.addEventListener('click', handleKeypadDelete);
  
  // Confirm key
  el.kpConfirmKey.addEventListener('click', confirmKeypadSelection);
  
  // Settings preset cards selection
  const settingsPresetCards = el.settingsPresets.querySelectorAll('.settings-preset-card');
  settingsPresetCards.forEach(card => {
    card.addEventListener('click', () => {
      settingsPresetCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      
      // Automatically prefill the manual inputs B and P values
      const b = card.getAttribute('data-base');
      const p = card.getAttribute('data-point');
      el.inputBase.value = b;
      el.inputPoint.value = p;
    });
  });

  // Watch manual input adjustments to update active preset button highlight in real-time
  const updatePresetHighlights = () => {
    const baseVal = parseInt(el.inputBase.value) || 0;
    const pointVal = parseInt(el.inputPoint.value) || 0;
    
    settingsPresetCards.forEach(card => {
      const b = parseInt(card.getAttribute('data-base'));
      const p = parseInt(card.getAttribute('data-point'));
      if (b === baseVal && p === pointVal) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    });
  };
  el.inputBase.addEventListener('input', updatePresetHighlights);
  el.inputPoint.addEventListener('input', updatePresetHighlights);

  // Settings modal opening and closing
  el.openSettingsBtn.addEventListener('click', openSettings);
  el.closeSettingsBtn.addEventListener('click', closeSettings);
  el.btnSaveSettings.addEventListener('click', saveSettings);
  el.btnResetAll.addEventListener('click', resetSession);
  
  // PWA Install Button
  if (el.btnInstallPWA) {
    el.btnInstallPWA.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      // Show the prompt
      deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`[PWA] User response to the install prompt: ${outcome}`);
      // We've used the prompt, and can't use it again, discard it
      deferredPrompt = null;
      // Hide the button
      el.btnInstallPWA.classList.add('hidden');
    });
  }
  
  // Big Hand Modal Controls
  el.closeBigHandBtn.addEventListener('click', closeBigHand);
  el.btnSkipBigHand.addEventListener('click', skipBigHandRecord);
  el.btnConfirmBigHand.addEventListener('click', confirmBigHandRecord);
  
  // Preset buttons for Big Hand
  const bigHandPresetBtns = el.bigHandPresets.querySelectorAll('.hand-type-preset');
  bigHandPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const isSelected = btn.classList.contains('selected');
      bigHandPresetBtns.forEach(p => p.classList.remove('selected'));
      if (!isSelected) {
        btn.classList.add('selected');
      }
    });
  });
  
  // Daily Details Page Controls
  el.btnBackToHome.addEventListener('click', closeDailyDetailsPage);

  // Close modals when clicking overlay background
  el.keypadModal.addEventListener('click', (e) => {
    if (e.target === el.keypadModal) closeKeypad();
  });
  el.settingsModal.addEventListener('click', (e) => {
    if (e.target === el.settingsModal) closeSettings();
  });
  el.bigHandModal.addEventListener('click', (e) => {
    if (e.target === el.bigHandModal) closeBigHand();
  });
  
  // Close details slide-over when clicking outside details area (for safety)
  el.detailsPage.addEventListener('click', (e) => {
    if (e.target === el.detailsPage) closeDailyDetailsPage();
  });
}

// --- 11. Run App ---
document.addEventListener('DOMContentLoaded', init);
