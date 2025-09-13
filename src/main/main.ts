import { app, BrowserWindow, ipcMain, Tray, Menu } from 'electron';
import * as path from 'path';
import { CoinPrice, PriceData, WindowMessage } from '../shared/types';

let mainWindow: BrowserWindow;
let tray: Tray;
let wsConnections: Map<string, WebSocket> = new Map();
let isQuitting = false;

const createWindow = (): void => {
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
  // Create a simple 16x16 bitmap icon for the tray
  const { nativeImage } = require('electron');

  // Create a simple icon with text "₿" (Bitcoin symbol)
  const iconData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0xF3, 0xFF, 0x61, 0x00, 0x00, 0x00,
    0x19, 0x74, 0x45, 0x58, 0x74, 0x53, 0x6F, 0x66, 0x74, 0x77, 0x61, 0x72,
    0x65, 0x00, 0x41, 0x64, 0x6F, 0x62, 0x65, 0x20, 0x49, 0x6D, 0x61, 0x67,
    0x65, 0x52, 0x65, 0x61, 0x64, 0x79, 0x71, 0xC9, 0x65, 0x3C, 0x00, 0x00,
    0x00, 0x44, 0x49, 0x44, 0x41, 0x54, 0x78, 0xDA, 0x94, 0x93, 0x41, 0x0A,
    0x00, 0x20, 0x08, 0x04, 0xE7, 0xFE, 0x8F, 0xDD, 0x81, 0x36, 0x81, 0x20,
    0xD8, 0x12, 0x30, 0x83, 0x30, 0x83, 0x30, 0x83, 0x30, 0x83, 0x30, 0x83,
    0x30, 0x83, 0x30, 0x83, 0x30, 0x83, 0x30, 0x83, 0x30, 0x83, 0x30, 0x83,
    0x30, 0x83, 0x30, 0x83, 0x30, 0x83, 0x30, 0x83, 0x30, 0x83, 0x30, 0x83,
    0xFE, 0x07, 0x91, 0x16, 0x01, 0x0A, 0x46, 0x4D, 0x98, 0x32, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);

  const trayImage = nativeImage.createFromBuffer(iconData);

  // Fallback: create simple colored square if above doesn't work
  if (trayImage.isEmpty()) {
    const canvas = nativeImage.createEmpty();
    canvas.addRepresentation({ scaleFactor: 1.0, width: 16, height: 16,
      buffer: Buffer.alloc(16 * 16 * 4, 0x80) // Gray square
    });
    tray = new Tray(canvas);
  } else {
    tray = new Tray(trayImage);
  }

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
  tray.setToolTip('CoinWidget2 - Crypto Price Tracker');

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