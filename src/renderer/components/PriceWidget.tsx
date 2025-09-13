import React, { useState, useEffect } from 'react';
import { PriceData, PriceHistoryPoint, BinanceSymbol } from '../../shared/types';
import { CHART_CONFIG, CALCULATED_CONFIG } from '../../shared/config';
import PriceChart from './PriceChart';

interface PriceState {
  [symbol: string]: PriceData | null;
}

interface HistoryState {
  [symbol: string]: PriceHistoryPoint[];
}

const { ipcRenderer } = window.require('electron');

const PriceWidget: React.FC = () => {
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>([]);
  const [prices, setPrices] = useState<PriceState>({});
  const [priceHistory, setPriceHistory] = useState<HistoryState>({});
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [availableSymbols, setAvailableSymbols] = useState<BinanceSymbol[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Load watched symbols and historical data on component mount
  useEffect(() => {
    const loadWatchedSymbols = async () => {
      try {
        const symbols = await ipcRenderer.invoke('get-watched-symbols');
        setWatchedSymbols(symbols);

        // Initialize price and history states
        const initialPrices: PriceState = {};
        const initialHistory: HistoryState = {};
        symbols.forEach((symbol: string) => {
          initialPrices[symbol] = null;
          initialHistory[symbol] = [];
        });
        setPrices(initialPrices);
        setPriceHistory(initialHistory);

        // Load historical data for each symbol
        await loadHistoricalData(symbols);
      } catch (error) {
        console.error('Failed to load watched symbols:', error);
      }
    };

    loadWatchedSymbols();
  }, []);

  const loadHistoricalData = async (symbols: string[]) => {
    console.log('Loading historical data...');

    const now = Date.now();
    const historyStartTime = now - CALCULATED_CONFIG.HISTORY_MS;

    for (const symbol of symbols) {
      try {
        const binanceSymbol = `${symbol.toUpperCase()}USDT`;
        // Binance Klines API for configured interval and history duration
        const response = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${CHART_CONFIG.BINANCE_INTERVAL}&startTime=${historyStartTime}&limit=${CALCULATED_CONFIG.MAX_DATA_POINTS}`
        );

        if (response.ok) {
          const klines = await response.json();
          const historicalPoints = klines.map((kline: any[]) => ({
            timestamp: kline[0], // Open time
            price: parseFloat(kline[4]), // Close price
            time: new Date(kline[0]).toLocaleTimeString()
          }));

          console.log(`Loaded ${historicalPoints.length} historical points for ${symbol}`);

          setPriceHistory(prev => ({
            ...prev,
            [symbol]: historicalPoints
          }));
        }
      } catch (error) {
        console.error(`Failed to load historical data for ${symbol}:`, error);
      }
    }
  };

  // Load available symbols for adding new ones
  useEffect(() => {
    const loadAvailableSymbols = async () => {
      try {
        const symbols = await ipcRenderer.invoke('get-binance-symbols');
        setAvailableSymbols(symbols);
      } catch (error) {
        console.error('Failed to load available symbols:', error);
      }
    };

    if (showAddModal) {
      loadAvailableSymbols();
    }
  }, [showAddModal]);

  // Handle adding a symbol
  const handleAddSymbol = async (baseAsset: string) => {
    try {
      const success = await ipcRenderer.invoke('add-symbol', baseAsset);
      if (success) {
        const updatedSymbols = await ipcRenderer.invoke('get-watched-symbols');
        setWatchedSymbols(updatedSymbols);

        // Initialize states for new symbol
        setPrices(prev => ({ ...prev, [baseAsset]: null }));
        setPriceHistory(prev => ({ ...prev, [baseAsset]: [] }));

        // Load historical data for new symbol
        await loadHistoricalData([baseAsset]);

        setShowAddModal(false);
        setSearchTerm('');
      }
    } catch (error) {
      console.error('Failed to add symbol:', error);
    }
  };

  // Handle removing a symbol
  const handleRemoveSymbol = async (symbol: string) => {
    try {
      const success = await ipcRenderer.invoke('remove-symbol', symbol);
      if (success) {
        const updatedSymbols = await ipcRenderer.invoke('get-watched-symbols');
        setWatchedSymbols(updatedSymbols);

        // Remove from states
        setPrices(prev => {
          const newPrices = { ...prev };
          delete newPrices[symbol];
          return newPrices;
        });
        setPriceHistory(prev => {
          const newHistory = { ...prev };
          delete newHistory[symbol];
          return newHistory;
        });

        // Clear selection if removed symbol was selected
        if (selectedCoin === symbol) {
          setSelectedCoin(null);
        }
      }
    } catch (error) {
      console.error('Failed to remove symbol:', error);
    }
  };

  useEffect(() => {
    const handlePriceUpdate = (event: any, data: { symbol: string; data: PriceData }) => {
      const symbol = data.symbol;
      const price = parseFloat(data.data.price);
      const timestamp = data.data.timestamp;

      // Update current price
      setPrices(prev => ({
        ...prev,
        [symbol]: data.data
      }));

      // Update price history with smart frequency control
      setPriceHistory(prev => {
        const currentHistory = prev[symbol] || [];
        const lastPoint = currentHistory[currentHistory.length - 1];

        // If no previous points, always add the first one
        if (!lastPoint) {
          return {
            ...prev,
            [symbol]: [{
              timestamp,
              price,
              time: new Date(timestamp).toLocaleTimeString()
            }]
          };
        }

        const timeDiff = timestamp - lastPoint.timestamp;
        const newHistory = [...currentHistory];

        // If within configured interval of last point, update the last point instead of adding new one
        if (timeDiff < CALCULATED_CONFIG.INTERVAL_MS) {
          // Update the last point with the new price (most recent within the interval)
          newHistory[newHistory.length - 1] = {
            timestamp,
            price,
            time: new Date(timestamp).toLocaleTimeString()
          };
        } else {
          // Add new point if more than configured interval has passed
          newHistory.push({
            timestamp,
            price,
            time: new Date(timestamp).toLocaleTimeString()
          });

          // Keep only configured maximum data points
          if (newHistory.length > CALCULATED_CONFIG.MAX_DATA_POINTS) {
            newHistory.shift();
          }
        }

        return {
          ...prev,
          [symbol]: newHistory
        };
      });
    };

    ipcRenderer.on('price-update', handlePriceUpdate);

    return () => {
      ipcRenderer.removeListener('price-update', handlePriceUpdate);
    };
  }, []);

  const handleClose = () => {
    ipcRenderer.send('close-app');
  };

  const handleMinimize = () => {
    ipcRenderer.send('minimize-app');
  };

  const formatPrice = (price: string | undefined) => {
    if (!price) return 'Loading...';
    return `$${parseFloat(price).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };

  const handleCoinClick = (symbol: string) => {
    console.log('Current selected:', selectedCoin);
    const newSelection = selectedCoin === symbol ? null : symbol;
    setSelectedCoin(newSelection);
  };

  // Comprehensive color schema for cryptocurrency symbols
  const COLOR_SCHEMA = [
    '#FF6B35', // Vibrant Orange (Bitcoin-like)
    '#4ECDC4', // Teal (Ethereum-like)
    '#45B7D1', // Sky Blue
    '#96CEB4', // Mint Green
    '#FFEAA7', // Warm Yellow
    '#DDA0DD', // Plum
    '#F39C12', // Orange
    '#E74C3C', // Red
    '#9B59B6', // Purple
    '#1ABC9C', // Emerald
    '#3498DB', // Blue
    '#E67E22', // Carrot
    '#2ECC71', // Green
    '#F1C40F', // Yellow
    '#E91E63', // Pink
    '#FF5722', // Deep Orange
    '#795548', // Brown
    '#607D8B', // Blue Grey
    '#FF9800', // Amber
    '#8BC34A', // Light Green
  ];

  // Get color for symbol based on its position in watched symbols list
  const getSymbolColor = (symbol: string) => {
    const index = watchedSymbols.indexOf(symbol);
    return index !== -1 ? COLOR_SCHEMA[index % COLOR_SCHEMA.length] : COLOR_SCHEMA[0];
  };

  // Filter available symbols based on search
  const filteredSymbols = availableSymbols.filter(symbol =>
    !watchedSymbols.includes(symbol.baseAsset) &&
    (symbol.baseAsset.toLowerCase().includes(searchTerm.toLowerCase()) ||
     symbol.symbol.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Auto-resize window when chart is shown/hidden or symbol count changes
  useEffect(() => {
    const resizeWindow = () => {
      // Base dimensions
      const baseWidth = 300;
      const symbolListHeight = Math.max(2, watchedSymbols.length) * 40; // 40px per symbol row, minimum 2 rows
      const headerHeight = 50; // Header with title and buttons

      // Additional height when chart is shown
      const chartHeight = selectedCoin ? CHART_CONFIG.CHART_HEIGHT + 80 : 0; // +80 for padding and header
      const modalHeight = showAddModal ? 200 : 0; // Height for add symbol modal

      const newWidth = selectedCoin ? 400 : baseWidth; // Wider when chart is shown
      const newHeight = headerHeight + symbolListHeight + chartHeight + modalHeight + 20; // +20 for padding

      console.log(`Auto-resizing window: symbols=${watchedSymbols.length}, chart=${selectedCoin ? 'shown' : 'hidden'}, modal=${showAddModal ? 'shown' : 'hidden'}`);
      console.log(`New dimensions: ${newWidth}x${newHeight}`);

      // Send resize request to main process
      ipcRenderer.send('resize-window', { width: newWidth, height: newHeight });
    };

    // Resize after a short delay to allow DOM updates
    const timeoutId = setTimeout(resizeWindow, 100);

    return () => clearTimeout(timeoutId);
  }, [selectedCoin, watchedSymbols.length, showAddModal]); // Trigger when these change

  // Set initial window size on component mount
  useEffect(() => {
    const setInitialSize = () => {
      const baseWidth = 300;
      const baseHeight = 150; // Start with reasonable default
      console.log('Setting initial window size');
      ipcRenderer.send('resize-window', { width: baseWidth, height: baseHeight });
    };

    // Set initial size after component mounts
    const timeoutId = setTimeout(setInitialSize, 200);

    return () => clearTimeout(timeoutId);
  }, []); // Only run once on mount

  return (
    <div className="widget-container">
      <div className="widget-header">
        <h3 className="widget-title">Crypto Prices</h3>
        <div className="controls">
          <button className="control-btn add-btn" onClick={() => setShowAddModal(true)} title="Add Symbol">
            +
          </button>
          <button className="control-btn minimize-btn" onClick={handleMinimize}>
            −
          </button>
          <button className="control-btn close-btn" onClick={handleClose}>
            ×
          </button>
        </div>
      </div>

      <div className="price-list">
        {watchedSymbols.map((symbol) => (
          <div
            key={symbol}
            className={`price-item clickable ${selectedCoin === symbol ? 'active' : ''}`}
            onClick={() => handleCoinClick(symbol)}
            style={{
              borderLeft: `3px solid ${getSymbolColor(symbol)}`,
            }}
          >
            <span className="coin-symbol" style={{ color: getSymbolColor(symbol) }}>
              {symbol}
            </span>
            <span
              className={`coin-price ${!prices[symbol] ? 'loading' : ''}`}
              style={{
                color: !prices[symbol] ? '#888' : getSymbolColor(symbol),
                fontWeight: 'bold'
              }}
            >
              {formatPrice(prices[symbol]?.price)}
            </span>
            <button
              className="remove-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveSymbol(symbol);
              }}
              title="Remove Symbol"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {showAddModal && (
        <div className="add-modal">
          <div className="modal-header">
            <h4>Add Symbol</h4>
            <button className="close-modal-btn" onClick={() => setShowAddModal(false)}>×</button>
          </div>
          <input
            type="text"
            placeholder="Search symbols..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <div className="symbol-list">
            {filteredSymbols.slice(0, 10).map((symbol) => (
              <div
                key={symbol.symbol}
                className="symbol-option"
                onClick={() => handleAddSymbol(symbol.baseAsset)}
              >
                <span className="symbol-name">{symbol.baseAsset}</span>
                <span className="symbol-pair">{symbol.symbol}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedCoin && priceHistory[selectedCoin] && (
        <PriceChart
          data={priceHistory[selectedCoin]}
          symbol={selectedCoin}
          color={getSymbolColor(selectedCoin)}
        />
      )}
    </div>
  );
};

export default PriceWidget;