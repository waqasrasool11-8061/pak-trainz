// Electron IPC bridge (or fallback)
let ipc = null;
try {
  const { ipcRenderer } = require('electron');
  ipc = ipcRenderer;
} catch (e) {
  console.warn("Running outside Electron IPC environment, using simulation mode");
}

let currentHWID = 'HWID-DETECTING...';
let currentTrainzInfo = null;
let unlockedProducts = [];
let isDeveloperMode = false;
let serverBaseUrl = localStorage.getItem('trs_server_url') || 'https://pak-trainz.vercel.app';

// Initialize App
window.addEventListener('DOMContentLoaded', async () => {
  // Titlebar controls
  document.getElementById('btnMin')?.addEventListener('click', () => ipc?.invoke('window-minimize'));
  document.getElementById('btnMax')?.addEventListener('click', () => ipc?.invoke('window-maximize'));
  document.getElementById('btnClose')?.addEventListener('click', () => ipc?.invoke('window-close'));

  // Get HWID
  if (ipc) {
    try {
      currentHWID = await ipc.invoke('get-hwid');
    } catch (e) {
      currentHWID = 'HWID-WIN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    }
  } else {
    currentHWID = 'HWID-BROWSER-DEMO';
  }
  document.getElementById('dispUserHwid').innerText = currentHWID;

  // Detect Trainz
  await checkTrainzDetection();

  // Load saved session
  loadSavedSession();
});

// View Navigation
function switchView(viewName) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.view-pane').forEach(el => el.classList.remove('active'));

  const navs = document.querySelectorAll('.nav-item');
  if (viewName === 'library') navs[0]?.classList.add('active');
  if (viewName === 'activate') navs[1]?.classList.add('active');
  if (viewName === 'developer') navs[2]?.classList.add('active');
  if (viewName === 'settings') navs[3]?.classList.add('active');

  const pane = document.getElementById(`view-${viewName}`);
  if (pane) pane.classList.add('active');
}

// Trainz Detection
async function checkTrainzDetection() {
  const statusEl = document.getElementById('trainzStatusText');
  const pathInput = document.getElementById('cfgTrainzPath');
  const detectStatus = document.getElementById('trainzDetectStatus');

  const savedPath = localStorage.getItem('trs_trainz_path');
  if (savedPath) {
    currentTrainzInfo = { path: savedPath };
    pathInput.value = savedPath;
    statusEl.innerText = 'Trainz: Configured';
    detectStatus.innerText = 'Path loaded from settings.';
    return;
  }

  if (ipc) {
    try {
      const detected = await ipc.invoke('detect-trainz');
      if (detected) {
        currentTrainzInfo = detected;
        pathInput.value = detected.path;
        statusEl.innerText = `Trainz: ${detected.version || 'Detected'}`;
        detectStatus.innerText = `Auto-detected: ${detected.path}`;
      } else {
        statusEl.innerText = 'Trainz: Not Detected (Please set folder)';
        detectStatus.innerText = 'TrainzUtil.exe not found in default paths. Please click Browse.';
      }
    } catch (e) {
      statusEl.innerText = 'Trainz: Detection Error';
    }
  } else {
    statusEl.innerText = 'Trainz: Ready (Desktop Mode)';
  }
}

// Browse folder
async function handleBrowseFolder() {
  if (!ipc) {
    alert("Folder selection dialog is active in Windows Desktop mode.");
    return;
  }

  const result = await ipc.invoke('browse-trainz-folder');
  if (result && result.path) {
    currentTrainzInfo = result;
    document.getElementById('cfgTrainzPath').value = result.path;
    localStorage.setItem('trs_trainz_path', result.path);
    document.getElementById('trainzStatusText').innerText = 'Trainz: Custom Directory';
    document.getElementById('trainzDetectStatus').innerText = result.isValid ? 'Valid Trainz directory with TrainzUtil.exe!' : 'Notice: TrainzUtil.exe not found in this folder.';
  }
}

// Save Settings
function saveSettings() {
  const url = document.getElementById('cfgServerUrl').value.trim();
  const path = document.getElementById('cfgTrainzPath').value.trim();

  if (url) {
    serverBaseUrl = url.replace(/\/$/, '');
    localStorage.setItem('trs_server_url', serverBaseUrl);
  }

  if (path) {
    localStorage.setItem('trs_trainz_path', path);
  }

  alert("Settings saved successfully!");
}

// Customer License Activation
async function handleActivateLicense(e) {
  e.preventDefault();
  const email = document.getElementById('actEmail').value.trim();
  const key = document.getElementById('actKey').value.trim();
  const alertBox = document.getElementById('actAlert');
  const btn = document.getElementById('btnSubmitAct');

  alertBox.style.display = 'none';
  btn.disabled = true;
  btn.innerText = 'Verifying License...';

  try {
    const res = await fetch(`${serverBaseUrl}/api/client/verify-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, license_key: key, hwid: currentHWID })
    });

    const data = await res.json();
    if (data.success) {
      alertBox.style.display = 'block';
      alertBox.style.background = 'rgba(16, 185, 129, 0.2)';
      alertBox.style.color = '#86efac';
      alertBox.innerText = `License Valid! ${data.is_developer ? '👑 Master Bypass Active' : 'Locked to this PC'}`;

      if (data.products && Array.isArray(data.products)) {
        unlockedProducts = data.products;
      } else if (data.product) {
        // Add single product if not already in library
        if (!unlockedProducts.find(p => p.id === data.product.id)) {
          unlockedProducts.push(data.product);
        }
      }

      saveSession();
      renderAddonsGrid();

      setTimeout(() => {
        switchView('library');
      }, 1000);

    } else {
      alertBox.style.display = 'block';
      alertBox.style.background = 'rgba(239, 68, 68, 0.2)';
      alertBox.style.color = '#fca5a5';
      alertBox.innerText = data.error || 'License activation failed';
    }
  } catch (err) {
    alertBox.style.display = 'block';
    alertBox.style.background = 'rgba(239, 68, 68, 0.2)';
    alertBox.style.color = '#fca5a5';
    alertBox.innerText = 'Connection error to authentication server.';
  } finally {
    btn.disabled = false;
    btn.innerText = '🚀 Verify License & Bind to this PC';
  }
}

// Developer Master Login (Waqas, Asif, Usman)
async function handleDevLogin(e) {
  e.preventDefault();
  const user = document.getElementById('devUser').value.trim();
  const pass = document.getElementById('devPass').value.trim();
  const alertBox = document.getElementById('devAlert');
  const btn = document.getElementById('btnDevSubmit');

  alertBox.style.display = 'none';
  btn.disabled = true;
  btn.innerText = 'Authenticating Developer...';

  try {
    const res = await fetch(`${serverBaseUrl}/api/client/developer-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass, hwid: currentHWID })
    });

    const data = await res.json();
    if (data.success && data.is_developer) {
      isDeveloperMode = true;
      document.getElementById('devBadge').style.display = 'inline-flex';

      alertBox.style.display = 'block';
      alertBox.style.background = 'rgba(192, 132, 252, 0.2)';
      alertBox.style.color = '#d8b4fe';
      alertBox.innerText = data.developer_notice || `Master Developer Mode Activated! All models unlocked.`;

      unlockedProducts = data.products || [];
      saveSession();
      renderAddonsGrid();

      setTimeout(() => {
        switchView('library');
      }, 1200);

    } else {
      alertBox.style.display = 'block';
      alertBox.style.background = 'rgba(239, 68, 68, 0.2)';
      alertBox.style.color = '#fca5a5';
      alertBox.innerText = data.error || 'Developer authentication failed';
    }
  } catch (err) {
    alertBox.style.display = 'block';
    alertBox.style.background = 'rgba(239, 68, 68, 0.2)';
    alertBox.style.color = '#fca5a5';
    alertBox.innerText = 'Connection error to master server.';
  } finally {
    btn.disabled = false;
    btn.innerText = '👑 Activate Developer Master Mode';
  }
}

// Render Addons in Grid
function renderAddonsGrid() {
  const grid = document.getElementById('addonsGrid');
  if (!unlockedProducts.length) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align:center; padding:50px 20px; color:#94a3b8;">
        <div style="font-size:2.5rem; margin-bottom:12px;">🚂</div>
        <h3>No Addons Activated Yet</h3>
        <p style="font-size:0.9rem; margin-top:6px; max-width:480px; margin-left:auto; margin-right:auto;">
          Click <strong>"License Activation"</strong> to enter your purchase key, or click <strong>"Developer Master Login"</strong> to unlock all models.
        </p>
      </div>
    `;
    return;
  }

  const installedKeys = JSON.parse(localStorage.getItem('trs_installed_addons') || '[]');

  grid.innerHTML = unlockedProducts.map(p => {
    const isInstalled = installedKeys.includes(p.id);
    const imageUrl = p.image_url ? (p.image_url.startsWith('http') ? p.image_url : `${serverBaseUrl}/${p.image_url}`) : '../Pictures & Videos/1.png';

    return `
      <div class="addon-card">
        <div class="addon-thumb">
          <img src="${imageUrl}" alt="${p.title}" onerror="this.src='../Pictures & Videos/1.png'">
          <span class="addon-badge">${p.badge || (isDeveloperMode ? 'MASTER' : 'OFFICIAL')}</span>
        </div>
        <div class="addon-body">
          <div>
            <h3 class="addon-title">${p.title}</h3>
            <div class="addon-meta">
              <span>${p.version || 'TRS19 / TRS22'}</span> &bull; 
              <span>${p.file_size || 'Full Pack'}</span>
            </div>
            ${p.kuid ? `<div style="font-size:0.75rem; font-family:monospace; color:#38bdf8; margin-bottom:10px;">${p.kuid}</div>` : ''}
          </div>

          <button class="btn-install" id="btnInstall_${p.id}" ${isInstalled ? 'style="background:#334155;"' : ''} onclick="handleInstallAddon(${p.id})">
            ${isInstalled ? '✅ Reinstall / Repair' : '🚀 1-Click Install into Trainz'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// 1-Click Install Addon into Trainz
async function handleInstallAddon(productId) {
  const product = unlockedProducts.find(p => p.id === productId);
  if (!product) return;

  const btn = document.getElementById(`btnInstall_${productId}`);
  if (btn) btn.disabled = true;

  const progressBox = document.getElementById('installProgressBox');
  const titleEl = document.getElementById('installProgressTitle');
  const statusEl = document.getElementById('installStatusText');

  progressBox.style.display = 'block';
  titleEl.innerText = `Installing: ${product.title}`;
  statusEl.innerText = '1/3 Downloading encrypted model stream...';

  // Build target download URL
  let downloadUrl = product.download_url || product.file_url;
  if (!downloadUrl.startsWith('http') && !downloadUrl.startsWith('https')) {
    downloadUrl = `${serverBaseUrl}/${downloadUrl}`;
  }

  const trainzPath = currentTrainzInfo?.path || localStorage.getItem('trs_trainz_path') || '';

  if (ipc) {
    statusEl.innerText = '2/3 Passing stream to TrainzUtil Content Manager...';
    try {
      const res = await ipc.invoke('inject-addon-into-trainz', {
        downloadUrl,
        productTitle: product.title,
        trainzPath
      });

      if (res.success) {
        statusEl.innerText = `3/3 ${res.message}`;
        // Mark as installed
        const installedKeys = JSON.parse(localStorage.getItem('trs_installed_addons') || '[]');
        if (!installedKeys.includes(product.id)) {
          installedKeys.push(product.id);
          localStorage.setItem('trs_installed_addons', JSON.stringify(installedKeys));
        }

        setTimeout(() => {
          progressBox.style.display = 'none';
          renderAddonsGrid();
        }, 2500);

      } else {
        statusEl.innerText = `Error: ${res.error}`;
        alert(`Installation error: ${res.error}`);
      }
    } catch (e) {
      statusEl.innerText = `Injection failed: ${e.message}`;
    }
  } else {
    // Browser simulation
    setTimeout(() => {
      statusEl.innerText = '3/3 Successfully simulated installation!';
      setTimeout(() => {
        progressBox.style.display = 'none';
      }, 2000);
    }, 1500);
  }

  if (btn) btn.disabled = false;
}

// Launch Trainz Simulator Game
async function handleLaunchTrainz() {
  const trainzPath = currentTrainzInfo?.path || localStorage.getItem('trs_trainz_path');
  if (!trainzPath) {
    alert("Trainz installation directory is not configured. Please go to Settings & set your Trainz directory.");
    switchView('settings');
    return;
  }

  if (ipc) {
    const res = await ipc.invoke('launch-trainz-game', trainzPath);
    if (!res.success) {
      alert(res.error || "Failed to launch Trainz.");
    }
  } else {
    alert("Launch command triggered! (Available in Windows Desktop mode)");
  }
}

// Session Persistence
function saveSession() {
  localStorage.setItem('trs_unlocked_products', JSON.stringify(unlockedProducts));
  localStorage.setItem('trs_dev_mode', isDeveloperMode ? '1' : '0');
}

function loadSavedSession() {
  try {
    const saved = localStorage.getItem('trs_unlocked_products');
    if (saved) {
      unlockedProducts = JSON.parse(saved);
    }
    isDeveloperMode = localStorage.getItem('trs_dev_mode') === '1';
    if (isDeveloperMode) {
      document.getElementById('devBadge').style.display = 'inline-flex';
    }
    renderAddonsGrid();
  } catch (e) {
    console.error("Session load err:", e);
  }
}

function refreshLibrary() {
  renderAddonsGrid();
}
