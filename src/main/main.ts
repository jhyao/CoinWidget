import { app, BrowserWindow, ipcMain, Tray, Menu } from 'electron';
import * as path from 'path';
import { CoinPrice, PriceData, WindowMessage } from '../shared/types';

let mainWindow: BrowserWindow;
let tray: Tray;
let wsConnections: Map<string, WebSocket> = new Map();
let isQuitting = false;

const createWindow = (): void => {
  const iconPath = path.join(__dirname, '..', 'src', 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 200,
    height: 150,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    minWidth: 200,
    minHeight: 150,
    title: 'CoinWidget',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const isDev = process.env.NODE_ENV === 'development';

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.setPosition(50, 50);

  mainWindow.on('close', (event: any) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
};

const createTray = (): void => {
  const { nativeImage } = require('electron');

  // Use the 32x32 PNG icon for better tray quality
  const iconPath = path.join(__dirname, '..', 'src', 'assets', 'icon-32.png');
  let trayImage;

  try {
    trayImage = nativeImage.createFromPath(iconPath);
  } catch (error) {
    console.log('Could not load tray icon, using fallback');
    // Fallback: create simple colored square
    trayImage = nativeImage.createEmpty();
    trayImage.addRepresentation({
      scaleFactor: 1.0,
      width: 16,
      height: 16,
      buffer: Buffer.alloc(16 * 16 * 4, 0x80) // Gray square
    });
  }

  tray = new Tray(trayImage);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Widget',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Hide Widget',
      click: () => {
        mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('CoinWidget');

  // Double click to show/hide
  tray.on('double-click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
};

const connectToBinance = (): void => {
  const symbols = ['btcusdt', 'ethusdt'];

  symbols.forEach(symbol => {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@ticker`);

    ws.onopen = () => {
      console.log(`Connected to ${symbol} stream`);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const priceData: PriceData = {
          symbol: data.s,
          price: parseFloat(data.c).toFixed(2),
          timestamp: Date.now()
        };

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('price-update', {
            symbol: symbol.replace('usdt', '').toUpperCase(),
            data: priceData
          });
        }
      } catch (error) {
        console.error('Error parsing price data:', error);
      }
    };

    ws.onerror = (error) => {
      console.error(`WebSocket error for ${symbol}:`, error);
    };

    ws.onclose = () => {
      console.log(`Connection closed for ${symbol}, reconnecting...`);
      setTimeout(() => connectToBinance(), 5000);
    };

    wsConnections.set(symbol, ws);
  });
};

app.whenReady().then(() => {
  createWindow();
  createTray();
  connectToBinance();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit the app when window is closed, keep tray running
  // Only quit if explicitly requested via tray menu
});

ipcMain.on('close-app', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.on('minimize-app', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

// Handle window resize requests from renderer
ipcMain.on('resize-window', (event, { width, height }) => {
  if (mainWindow) {
    console.log(`Resizing window to: ${width}x${height}`);
    mainWindow.setSize(width, height);
  }
});

// Add global shortcut to toggle DevTools
app.whenReady().then(() => {
  const { globalShortcut } = require('electron');

  // Register Ctrl+Shift+I (or Cmd+Shift+I on Mac) to toggle DevTools
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
  });
});