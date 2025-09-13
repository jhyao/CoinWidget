import { app, BrowserWindow, ipcMain, Tray, Menu } from 'electron';
import * as path from 'path';
import { CoinPrice, PriceData, WindowMessage } from '../shared/types';

let mainWindow: BrowserWindow;
let tray: Tray;
let wsConnections: Map<string, WebSocket> = new Map();
let isQuitting = false;
let watchedSymbols: string[] = ['BTC', 'ETH']; // Default symbols
let reconnectTimeouts: Map<string, NodeJS.Timeout> = new Map();

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

        // Clean up WebSocket connections
        wsConnections.forEach((ws) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'App closing');
          }
        });
        wsConnections.clear();

        // Clear all reconnection timeouts
        reconnectTimeouts.forEach((timeout) => {
          clearTimeout(timeout);
        });
        reconnectTimeouts.clear();

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
  console.log('Setting up WebSocket connections for symbols:', watchedSymbols);

  // Clear all existing reconnection timeouts
  reconnectTimeouts.forEach((timeout) => {
    clearTimeout(timeout);
  });
  reconnectTimeouts.clear();

  // Close existing connections gracefully
  wsConnections.forEach((ws, symbol) => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, 'Reconnecting with new symbol list');
    }
  });
  wsConnections.clear();

  const symbols = watchedSymbols.map(symbol => `${symbol.toLowerCase()}usdt`);

  symbols.forEach(symbol => {
    connectToSymbol(symbol);
  });
};

const connectToSymbol = (symbol: string): void => {
  // Don't create connection if it already exists and is open
  const existingWs = wsConnections.get(symbol);
  if (existingWs && (existingWs.readyState === WebSocket.OPEN || existingWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log(`Connecting to ${symbol} stream...`);
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@ticker`);

  ws.onopen = () => {
    console.log(`✓ Connected to ${symbol} stream`);
    // Clear any pending reconnection timeout for this symbol
    const timeout = reconnectTimeouts.get(symbol);
    if (timeout) {
      clearTimeout(timeout);
      reconnectTimeouts.delete(symbol);
    }
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
      console.error(`Error parsing price data for ${symbol}:`, error);
    }
  };

  ws.onerror = (error) => {
    console.error(`WebSocket error for ${symbol}:`, error);
  };

  ws.onclose = (event) => {
    console.log(`Connection closed for ${symbol} (code: ${event.code}, reason: ${event.reason})`);

    // Only reconnect if:
    // 1. The symbol is still in the watched list
    // 2. The close wasn't intentional (code 1000)
    // 3. We're not quitting the app
    if (!isQuitting &&
        watchedSymbols.some(s => `${s.toLowerCase()}usdt` === symbol) &&
        event.code !== 1000) {

      // Clear any existing timeout for this symbol
      const existingTimeout = reconnectTimeouts.get(symbol);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Set up reconnection with exponential backoff (5 seconds for now)
      const timeout = setTimeout(() => {
        console.log(`Attempting to reconnect to ${symbol}...`);
        connectToSymbol(symbol);
      }, 5000);

      reconnectTimeouts.set(symbol, timeout);
    }

    // Remove from connections map
    wsConnections.delete(symbol);
  };

  wsConnections.set(symbol, ws);
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

  // Clean up WebSocket connections
  wsConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'App closing');
    }
  });
  wsConnections.clear();

  // Clear all reconnection timeouts
  reconnectTimeouts.forEach((timeout) => {
    clearTimeout(timeout);
  });
  reconnectTimeouts.clear();

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

// Handle symbol management
ipcMain.handle('get-watched-symbols', () => {
  return watchedSymbols;
});

ipcMain.handle('add-symbol', (event, symbol: string) => {
  const upperSymbol = symbol.toUpperCase();
  if (!watchedSymbols.includes(upperSymbol)) {
    watchedSymbols.push(upperSymbol);
    connectToBinance(); // Reconnect with new symbols
    return true;
  }
  return false;
});

ipcMain.handle('remove-symbol', (event, symbol: string) => {
  const upperSymbol = symbol.toUpperCase();
  const index = watchedSymbols.indexOf(upperSymbol);
  if (index > -1) {
    watchedSymbols.splice(index, 1);
    connectToBinance(); // Reconnect with remaining symbols
    return true;
  }
  return false;
});

// Handle Binance API requests
ipcMain.handle('get-binance-symbols', async () => {
  try {
    const https = require('https');
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.binance.com',
        path: '/api/v3/exchangeInfo',
        method: 'GET'
      };

      const req = https.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            // Filter only USDT pairs and active symbols
            const usdtSymbols = response.symbols
              .filter((symbol: any) =>
                symbol.quoteAsset === 'USDT' &&
                symbol.status === 'TRADING'
              )
              .map((symbol: any) => ({
                symbol: symbol.symbol,
                baseAsset: symbol.baseAsset,
                quoteAsset: symbol.quoteAsset,
                status: symbol.status
              }));
            resolve(usdtSymbols);
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', (error: any) => {
        reject(error);
      });

      req.end();
    });
  } catch (error) {
    console.error('Error fetching Binance symbols:', error);
    return [];
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