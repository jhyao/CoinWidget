import { app, BrowserWindow, ipcMain, Tray, Menu } from 'electron';
import * as path from 'path';
import { CoinPrice, PriceData, WindowMessage, MarketType } from '../shared/types';

let mainWindow: BrowserWindow;
let tray: Tray;
let wsSpotConnection: WebSocket | null = null;
let wsPerpConnection: WebSocket | null = null;
let isQuitting = false;
let watchedSymbols: string[] = ['BTCUSDT', 'ETHUSDT']; // Default symbols - now using full notation
let reconnectTimeout: NodeJS.Timeout | null = null;
let perpReconnectTimeout: NodeJS.Timeout | null = null;
let requestId = 1; // For tracking subscribe/unsubscribe requests

// Helper functions for market type detection
const getMarketType = (symbol: string): MarketType => {
  // Check if symbol ends with PERP (e.g., BTCUSDTPERP or BTCUSDT_PERP)
  return symbol.includes('PERP') ? 'PERP' : 'SPOT';
};

const normalizeSymbol = (symbol: string): string => {
  // Normalize symbol format (remove underscores, uppercase)
  return symbol.replace(/_/g, '').toUpperCase();
};

const getBaseAsset = (symbol: string): string => {
  // Extract base asset from full symbol
  const normalized = normalizeSymbol(symbol);
  if (normalized.includes('PERP')) {
    return normalized.replace('USDTPERP', '').replace('PERP', '');
  }
  return normalized.replace('USDT', '');
};

const getWebSocketEndpoint = (marketType: MarketType): string => {
  return marketType === 'PERP'
    ? 'wss://fstream.binance.com/ws'
    : 'wss://stream.binance.com:9443/ws';
};

const getStreamName = (symbol: string): string => {
  const normalized = normalizeSymbol(symbol);
  const marketType = getMarketType(symbol);

  if (marketType === 'PERP') {
    // Binance Futures uses lowercase symbol WITHOUT 'PERP' suffix
    // Stream format: btcusdt@ticker (NOT btcusdtperp@ticker)
    const base = normalized.replace('PERP', '').replace('USDT', '').toLowerCase();
    return `${base}usdt@ticker`;
  } else {
    // Spot stream format: btcusdt@ticker
    return `${normalized.toLowerCase()}@ticker`;
  }
};

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

        // Clean up WebSocket connections
        if (wsSpotConnection && wsSpotConnection.readyState === WebSocket.OPEN) {
          wsSpotConnection.close(1000, 'App closing');
        }
        wsSpotConnection = null;

        if (wsPerpConnection && wsPerpConnection.readyState === WebSocket.OPEN) {
          wsPerpConnection.close(1000, 'App closing');
        }
        wsPerpConnection = null;

        // Clear reconnection timeouts
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }

        if (perpReconnectTimeout) {
          clearTimeout(perpReconnectTimeout);
          perpReconnectTimeout = null;
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
  console.log('Setting up WebSocket connections for symbols:', watchedSymbols);

  // Separate symbols by market type
  const spotSymbols = watchedSymbols.filter(s => getMarketType(s) === 'SPOT');
  const perpSymbols = watchedSymbols.filter(s => getMarketType(s) === 'PERP');

  // Connect to spot WebSocket if we have spot symbols
  if (spotSymbols.length > 0) {
    connectToSpotWebSocket(spotSymbols);
  }

  // Connect to perpetual futures WebSocket if we have perp symbols
  if (perpSymbols.length > 0) {
    connectToPerpWebSocket(perpSymbols);
  }
};

const connectToSpotWebSocket = (symbols: string[]): void => {
  // Close existing connection if any
  if (wsSpotConnection) {
    if (wsSpotConnection.readyState === WebSocket.OPEN) {
      wsSpotConnection.close(1000, 'Reconnecting with new symbol list');
    }
    wsSpotConnection = null;
  }

  // Clear existing reconnection timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  console.log('Connecting to Binance Spot WebSocket stream...');
  wsSpotConnection = new WebSocket(getWebSocketEndpoint('SPOT'));

  wsSpotConnection.onopen = () => {
    console.log('✓ Connected to Binance Spot WebSocket stream');

    // Subscribe to all current symbols
    if (symbols.length > 0) {
      subscribeToSymbols(symbols, 'SPOT');
    }

    // Clear any pending reconnection timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  wsSpotConnection.onmessage = (event) => {
    handleWebSocketMessage(event, 'SPOT');
  };

  wsSpotConnection.onerror = (error) => {
    console.error('Spot WebSocket error:', error);
  };

  wsSpotConnection.onclose = (event) => {
    console.log(`Spot WebSocket connection closed (code: ${event.code}, reason: ${event.reason})`);
    wsSpotConnection = null;

    // Only reconnect if close wasn't intentional and app isn't quitting
    if (!isQuitting && event.code !== 1000) {
      console.log('Attempting to reconnect Spot WebSocket in 5 seconds...');
      reconnectTimeout = setTimeout(() => {
        const spotSymbols = watchedSymbols.filter(s => getMarketType(s) === 'SPOT');
        if (spotSymbols.length > 0) {
          connectToSpotWebSocket(spotSymbols);
        }
      }, 5000);
    }
  };
};

const connectToPerpWebSocket = (symbols: string[]): void => {
  // Close existing connection if any
  if (wsPerpConnection) {
    if (wsPerpConnection.readyState === WebSocket.OPEN) {
      wsPerpConnection.close(1000, 'Reconnecting with new symbol list');
    }
    wsPerpConnection = null;
  }

  // Clear existing reconnection timeout
  if (perpReconnectTimeout) {
    clearTimeout(perpReconnectTimeout);
    perpReconnectTimeout = null;
  }

  console.log('Connecting to Binance Perpetual Futures WebSocket stream...');
  wsPerpConnection = new WebSocket(getWebSocketEndpoint('PERP'));

  wsPerpConnection.onopen = () => {
    console.log('✓ Connected to Binance Perpetual Futures WebSocket stream');

    // Subscribe to all current symbols
    if (symbols.length > 0) {
      subscribeToSymbols(symbols, 'PERP');
    }

    // Clear any pending reconnection timeout
    if (perpReconnectTimeout) {
      clearTimeout(perpReconnectTimeout);
      perpReconnectTimeout = null;
    }
  };

  wsPerpConnection.onmessage = (event) => {
    handleWebSocketMessage(event, 'PERP');
  };

  wsPerpConnection.onerror = (error) => {
    console.error('Perpetual Futures WebSocket error:', error);
  };

  wsPerpConnection.onclose = (event) => {
    console.log(`Perpetual Futures WebSocket connection closed (code: ${event.code}, reason: ${event.reason})`);
    wsPerpConnection = null;

    // Only reconnect if close wasn't intentional and app isn't quitting
    if (!isQuitting && event.code !== 1000) {
      console.log('Attempting to reconnect Perpetual Futures WebSocket in 5 seconds...');
      perpReconnectTimeout = setTimeout(() => {
        const perpSymbols = watchedSymbols.filter(s => getMarketType(s) === 'PERP');
        if (perpSymbols.length > 0) {
          connectToPerpWebSocket(perpSymbols);
        }
      }, 5000);
    }
  };
};

const handleWebSocketMessage = (event: MessageEvent, marketType: MarketType): void => {
  try {
    const message = JSON.parse(event.data.toString());

    // Handle subscription response
    if (message.result === null && message.id) {
      console.log(`✓ ${marketType} subscription request ${message.id} completed`);
      return;
    }

    // Debug logging - show all message types received
    if (marketType === 'PERP') {
      console.log(`PERP WebSocket message - event type: ${message.e}, symbol: ${message.s}`);
    }

    // Handle ticker data - both spot and futures use 24hrTicker event
    // Note: Futures might also use 'aggTrade' or other events
    if (message.e === '24hrTicker' && message.s && message.c) {
      const fullSymbol = marketType === 'PERP' ? `${message.s}PERP` : message.s;

      console.log(`${marketType} price update for ${fullSymbol}: ${message.c}`);

      const priceData: PriceData = {
        symbol: message.s,
        price: parseFloat(message.c).toFixed(2),
        priceChangePercent: message.P || '0.00',
        timestamp: Date.now(),
        marketType: marketType
      };

      const baseAsset = getBaseAsset(fullSymbol);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('price-update', {
          symbol: fullSymbol, // Send full symbol with PERP suffix if applicable
          data: priceData
        });
      }
    }
  } catch (error) {
    console.error(`Error parsing ${marketType} WebSocket message:`, error);
  }
};

const subscribeToSymbols = (symbols: string[], marketType: MarketType): void => {
  const wsConnection = marketType === 'PERP' ? wsPerpConnection : wsSpotConnection;

  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    console.log(`${marketType} WebSocket not ready, cannot subscribe`);
    return;
  }

  const streams = symbols.map(symbol => getStreamName(symbol));
  const subscribeMessage = {
    method: 'SUBSCRIBE',
    params: streams,
    id: requestId++
  };

  console.log(`Subscribing to ${marketType} streams:`, streams);
  wsConnection.send(JSON.stringify(subscribeMessage));
};

const unsubscribeFromSymbols = (symbols: string[], marketType: MarketType): void => {
  const wsConnection = marketType === 'PERP' ? wsPerpConnection : wsSpotConnection;

  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    console.log(`${marketType} WebSocket not ready, cannot unsubscribe`);
    return;
  }

  const streams = symbols.map(symbol => getStreamName(symbol));
  const unsubscribeMessage = {
    method: 'UNSUBSCRIBE',
    params: streams,
    id: requestId++
  };

  console.log(`Unsubscribing from ${marketType} streams:`, streams);
  wsConnection.send(JSON.stringify(unsubscribeMessage));
};

const addSymbolSubscription = (symbol: string): void => {
  const marketType = getMarketType(symbol);
  const wsConnection = marketType === 'PERP' ? wsPerpConnection : wsSpotConnection;

  // If the WebSocket for this market type doesn't exist or isn't ready, establish it
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    console.log(`${marketType} WebSocket not ready, establishing connection...`);
    if (marketType === 'PERP') {
      const perpSymbols = watchedSymbols.filter(s => getMarketType(s) === 'PERP');
      connectToPerpWebSocket(perpSymbols);
    } else {
      const spotSymbols = watchedSymbols.filter(s => getMarketType(s) === 'SPOT');
      connectToSpotWebSocket(spotSymbols);
    }
  } else {
    subscribeToSymbols([symbol], marketType);
  }
};

const removeSymbolSubscription = (symbol: string): void => {
  const marketType = getMarketType(symbol);
  const wsConnection = marketType === 'PERP' ? wsPerpConnection : wsSpotConnection;

  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    unsubscribeFromSymbols([symbol], marketType);

    // Check if there are any remaining symbols of this market type
    const remainingSymbols = watchedSymbols.filter(s => getMarketType(s) === marketType && s !== symbol);

    // If no more symbols of this type, close the WebSocket connection
    if (remainingSymbols.length === 0) {
      console.log(`No more ${marketType} symbols, closing ${marketType} WebSocket connection`);
      wsConnection.close(1000, 'No more symbols to watch');
      if (marketType === 'PERP') {
        wsPerpConnection = null;
      } else {
        wsSpotConnection = null;
      }
    }
  }
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
  if (wsSpotConnection && wsSpotConnection.readyState === WebSocket.OPEN) {
    wsSpotConnection.close(1000, 'App closing');
  }
  wsSpotConnection = null;

  if (wsPerpConnection && wsPerpConnection.readyState === WebSocket.OPEN) {
    wsPerpConnection.close(1000, 'App closing');
  }
  wsPerpConnection = null;

  // Clear reconnection timeouts
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (perpReconnectTimeout) {
    clearTimeout(perpReconnectTimeout);
    perpReconnectTimeout = null;
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

// Handle Binance API requests - fetch both spot and perpetual futures symbols
ipcMain.handle('get-binance-symbols', async () => {
  try {
    const https = require('https');

    // Fetch spot symbols
    const spotSymbolsPromise = new Promise((resolve, reject) => {
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
                status: symbol.status,
                marketType: 'SPOT' as MarketType
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

    // Fetch perpetual futures symbols
    const perpSymbolsPromise = new Promise((resolve, reject) => {
      const options = {
        hostname: 'fapi.binance.com',
        path: '/fapi/v1/exchangeInfo',
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
            // Filter only USDT perpetual futures and active symbols
            const perpSymbols = response.symbols
              .filter((symbol: any) =>
                symbol.quoteAsset === 'USDT' &&
                symbol.contractType === 'PERPETUAL' &&
                symbol.status === 'TRADING'
              )
              .map((symbol: any) => ({
                symbol: `${symbol.symbol}PERP`, // Add PERP suffix for display
                baseAsset: symbol.baseAsset,
                quoteAsset: symbol.quoteAsset,
                status: symbol.status,
                marketType: 'PERP' as MarketType
              }));
            resolve(perpSymbols);
          } catch (error) {
            console.error('Error parsing perpetual futures symbols:', error);
            resolve([]); // Return empty array on error rather than rejecting
          }
        });
      });

      req.on('error', (error: any) => {
        console.error('Error fetching perpetual futures symbols:', error);
        resolve([]); // Return empty array on error rather than rejecting
      });

      req.end();
    });

    // Wait for both requests to complete
    const [spotSymbols, perpSymbols] = await Promise.all([spotSymbolsPromise, perpSymbolsPromise]);

    // Combine and return both spot and perpetual futures symbols
    return [...(spotSymbols as any[]), ...(perpSymbols as any[])];
  } catch (error) {
    console.error('Error fetching Binance symbols:', error);
    return [];
  }
});

// Handle reconnect WebSocket request
ipcMain.handle('reconnect-websocket', () => {
  console.log('Reconnecting WebSocket connection...');
  connectToBinance();
  return true;
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