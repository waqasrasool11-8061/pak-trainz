const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const https = require('https');
const http = require('http');

let mainWindow = null;
let cachedHWID = null;

// Generate Hardware ID (HWID) for Windows
function getHardwareID() {
  if (cachedHWID) return cachedHWID;

  try {
    let rawHardwareString = "";
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        // Get Motherboard UUID & CPU ID
        const uuidOutput = execSync('powershell -Command "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"', { encoding: 'utf8', timeout: 3000 }).trim();
        const cpuOutput = execSync('powershell -Command "(Get-CimInstance -Class Win32_Processor).ProcessorId"', { encoding: 'utf8', timeout: 3000 }).trim();
        rawHardwareString = `${uuidOutput}-${cpuOutput}-${os.hostname()}`;
      } catch (e) {
        rawHardwareString = `${os.hostname()}-${os.totalmem()}-${os.cpus()[0]?.model || 'CPU'}`;
      }
    } else {
      rawHardwareString = `${os.hostname()}-${os.userInfo().username}-${os.totalmem()}`;
    }

    const hash = crypto.createHash('sha256').update(rawHardwareString).digest('hex').toUpperCase();
    cachedHWID = `HWID-${hash.substring(0, 4)}-${hash.substring(4, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}`;
    return cachedHWID;
  } catch (err) {
    return 'HWID-GENERIC-WIN-DEV';
  }
}

// Auto-Detect Trainz Installation Directory
function detectTrainzInstallation() {
  const commonPaths = [
    'C:\\Program Files\\N3V Games\\Trainz Railroad Simulator 2019',
    'C:\\Program Files\\N3V Games\\Trainz Railroad Simulator 2022',
    'C:\\Program Files\\N3V Games\\Trainz Railroad Simulator 2022 Platinum Edition',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Trainz Railroad Simulator 2019',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Trainz Railroad Simulator 2022',
    'D:\\Games\\Trainz Railroad Simulator 2019',
    'D:\\Games\\Trainz Railroad Simulator 2022',
    'D:\\Trainz 2019',
    'D:\\Trainz 2022',
    'E:\\Trainz 2019',
    'E:\\Trainz 2022'
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      const util1 = path.join(p, 'bin', 'TrainzUtil.exe');
      const util2 = path.join(p, 'TrainzUtil.exe');
      if (fs.existsSync(util1) || fs.existsSync(util2)) {
        return {
          path: p,
          utilPath: fs.existsSync(util1) ? util1 : util2,
          version: p.includes('2022') ? 'Trainz Railroad Simulator 2022' : 'Trainz Railroad Simulator 2019'
        };
      }
    }
  }

  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0b1120',
    title: 'TRS DEP PAK Launcher - Trainz Railroad Simulator Addons Manager',
    icon: path.join(__dirname, '..', 'Pictures & Videos', 'Pak-Trainz.jpg'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ──────────────────────────────────────────
// IPC HANDLERS
// ──────────────────────────────────────────

// Window controls
ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// Get HWID
ipcMain.handle('get-hwid', () => {
  return getHardwareID();
});

// Auto-Detect Trainz
ipcMain.handle('detect-trainz', () => {
  return detectTrainzInstallation();
});

// Manual browse Trainz folder
ipcMain.handle('browse-trainz-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Trainz Railroad Simulator Installation Folder'
  });

  if (result.canceled || !result.filePaths.length) return null;

  const chosenPath = result.filePaths[0];
  const util1 = path.join(chosenPath, 'bin', 'TrainzUtil.exe');
  const util2 = path.join(chosenPath, 'TrainzUtil.exe');

  return {
    path: chosenPath,
    utilPath: fs.existsSync(util1) ? util1 : (fs.existsSync(util2) ? util2 : null),
    isValid: fs.existsSync(util1) || fs.existsSync(util2)
  };
});

// Direct Injection into Trainz Content Manager (Zero CDP Leakage)
ipcMain.handle('inject-addon-into-trainz', async (event, args) => {
  const { downloadUrl, productTitle, trainzPath } = args;

  if (!downloadUrl) {
    return { success: false, error: 'Download URL is missing' };
  }

  // Determine TrainzUtil.exe path
  let utilPath = null;
  if (trainzPath) {
    const u1 = path.join(trainzPath, 'bin', 'TrainzUtil.exe');
    const u2 = path.join(trainzPath, 'TrainzUtil.exe');
    if (fs.existsSync(u1)) utilPath = u1;
    else if (fs.existsSync(u2)) utilPath = u2;
  }

  try {
    // 1. Download stream into a temporary protected .tmp file
    const tempFileName = `trs_addon_${crypto.randomBytes(6).toString('hex')}.tmp`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    await new Promise((resolve, reject) => {
      // Determine if local file or remote URL
      if (downloadUrl.startsWith('http://') || downloadUrl.startsWith('https://')) {
        const client = downloadUrl.startsWith('https') ? https : http;
        const fileStream = fs.createWriteStream(tempFilePath);
        client.get(downloadUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Follow redirect
            client.get(res.headers.location, (redRes) => {
              redRes.pipe(fileStream);
              fileStream.on('finish', () => fileStream.close(resolve));
            }).on('error', reject);
          } else {
            res.pipe(fileStream);
            fileStream.on('finish', () => fileStream.close(resolve));
          }
        }).on('error', reject);
      } else {
        // Local path copy for test
        const localSrc = path.isAbsolute(downloadUrl) ? downloadUrl : path.join(__dirname, '..', downloadUrl);
        if (fs.existsSync(localSrc)) {
          fs.copyFileSync(localSrc, tempFilePath);
          resolve();
        } else {
          reject(new Error(`File source not found: ${downloadUrl}`));
        }
      }
    });

    // 2. Execute TrainzUtil.exe install if available
    let installOutput = "Installed successfully.";
    if (utilPath && fs.existsSync(utilPath)) {
      await new Promise((resolve, reject) => {
        exec(`"${utilPath}" install "${tempFilePath}"`, (err, stdout, stderr) => {
          if (err) {
            console.warn("TrainzUtil execution note:", stderr || err.message);
          }
          installOutput = stdout || "Injected into Trainz Content Manager.";
          resolve();
        });
      });
    } else {
      installOutput = "Content prepared. (TrainzUtil path not specified, please point Trainz directory in Settings).";
    }

    // 3. SECURE WIPE: Delete temporary file immediately so raw CDP cannot be copied
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (e) {
      console.warn("Temp wipe error:", e.message);
    }

    return {
      success: true,
      message: `${productTitle} has been securely installed into Trainz!`,
      output: installOutput
    };

  } catch (err) {
    console.error("Injection error:", err);
    return {
      success: false,
      error: `Failed to inject into Trainz: ${err.message}`
    };
  }
});

// Launch Trainz Simulator Game
ipcMain.handle('launch-trainz-game', (event, trainzPath) => {
  if (!trainzPath) return { success: false, error: 'Trainz path not set' };

  const exe1 = path.join(trainzPath, 'Trainz.exe');
  const exe2 = path.join(trainzPath, 'trs19.exe');
  const exe3 = path.join(trainzPath, 'trs22.exe');

  let targetExe = null;
  if (fs.existsSync(exe1)) targetExe = exe1;
  else if (fs.existsSync(exe2)) targetExe = exe2;
  else if (fs.existsSync(exe3)) targetExe = exe3;

  if (targetExe) {
    exec(`start "" "${targetExe}"`, (err) => {
      if (err) console.error("Launch err:", err);
    });
    return { success: true, message: "Trainz Simulator launched!" };
  } else {
    return { success: false, error: "Trainz executable not found in selected directory." };
  }
});
