import { app, BrowserWindow, ipcMain, Tray, Menu } from 'electron';
import * as path from 'path';
import { CoinPrice, PriceData, WindowMessage } from '../shared/types';

let mainWindow: BrowserWindow;
let tray: Tray;
let wsConnection: WebSocket | null = null;
let isQuitting = false;
let watchedSymbols: string[] = ['BTC', 'ETH']; // Default symbols
let reconnectTimeout: NodeJS.Timeout | null = null;
let requestId = 1; // For tracking subscribe/unsubscribe requests

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

  
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setFullScreenable(false);
  // mainWindow.moveTop();

  const isDev = process.env.NODE_ENV === 'development';

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.setPosition(50, 50);

  // Ensure window stays on top even when losing focus
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

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

        // Clean up WebSocket connection
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
          wsConnection.close(1000, 'App closing');
        }
        wsConnection = null;

        // Clear reconnection timeout
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }

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
  console.log('Setting up single WebSocket connection for symbols:', watchedSymbols);

  // Close existing connection if any
  if (wsConnection) {
    if (wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.close(1000, 'Reconnecting with new symbol list');
    }
    wsConnection = null;
  }

  // Clear existing reconnection timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Create single WebSocket connection to Binance stream
  console.log('Connecting to Binance WebSocket stream...');
  wsConnection = new WebSocket('wss://stream.binance.com:9443/ws');

  wsConnection.onopen = () => {
    console.log('✓ Connected to Binance WebSocket stream');

    // Subscribe to all current symbols
    if (watchedSymbols.length > 0) {
      subscribeToSymbols(watchedSymbols);
    }

    // Clear any pending reconnection timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  wsConnection.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      // Handle subscription response
      if (message.result === null && message.id) {
        console.log(`✓ Subscription request ${message.id} completed`);
        return;
      }

      // Handle ticker data - direct format from individual subscriptions
      if (message.e === '24hrTicker' && message.s && message.c) {
        const priceData: PriceData = {
          symbol: message.s,
          price: parseFloat(message.c).toFixed(2),
          priceChangePercent: message.P || '0.00',
          timestamp: Date.now()
        };

        const symbol = message.s.replace('USDT', '');

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('price-update', {
            symbol: symbol,
            data: priceData
          });
        }
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  };

  wsConnection.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  wsConnection.onclose = (event) => {
    console.log(`WebSocket connection closed (code: ${event.code}, reason: ${event.reason})`);
    wsConnection = null;

    // Only reconnect if close wasn't intentional and app isn't quitting
    if (!isQuitting && event.code !== 1000) {
      console.log('Attempting to reconnect in 5 seconds...');
      reconnectTimeout = setTimeout(() => {
        connectToBinance();
      }, 5000);
    }
  };
};

const subscribeToSymbols = (symbols: string[]): void => {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    console.log('WebSocket not ready, cannot subscribe');
    return;
  }

  const streams = symbols.map(symbol => `${symbol.toLowerCase()}usdt@ticker`);
  const subscribeMessage = {
    method: 'SUBSCRIBE',
    params: streams,
    id: requestId++
  };

  console.log('Subscribing to streams:', streams);
  wsConnection.send(JSON.stringify(subscribeMessage));
};

const unsubscribeFromSymbols = (symbols: string[]): void => {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    console.log('WebSocket not ready, cannot unsubscribe');
    return;
  }

  const streams = symbols.map(symbol => `${symbol.toLowerCase()}usdt@ticker`);
  const unsubscribeMessage = {
    method: 'UNSUBSCRIBE',
    params: streams,
    id: requestId++
  };

  console.log('Unsubscribing from streams:', streams);
  wsConnection.send(JSON.stringify(unsubscribeMessage));
};

const addSymbolSubscription = (symbol: string): void => {
  subscribeToSymbols([symbol]);
};

const removeSymbolSubscription = (symbol: string): void => {
  unsubscribeFromSymbols([symbol]);
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

  // Clean up WebSocket connection
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.close(1000, 'App closing');
  }
  wsConnection = null;

  // Clear reconnection timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

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
    console.log(`Adding symbol: ${upperSymbol}`);

    // Add subscription for new symbol if connection is open
    addSymbolSubscription(upperSymbol);
    return true;
  }
  return false;
});

ipcMain.handle('remove-symbol', (event, symbol: string) => {
  const upperSymbol = symbol.toUpperCase();
  const index = watchedSymbols.indexOf(upperSymbol);
  if (index > -1) {
    console.log(`Removing symbol: ${upperSymbol}`);

    // Remove subscription for symbol if connection is open
    removeSymbolSubscription(upperSymbol);

    watchedSymbols.splice(index, 1);
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