import React, { useState, useEffect } from 'react';
import { PriceData, PriceHistoryPoint } from '../../shared/types';
import { CHART_CONFIG, CALCULATED_CONFIG } from '../../shared/config';
import PriceChart from './PriceChart';

interface PriceState {
  BTC: PriceData | null;
  ETH: PriceData | null;
}

interface HistoryState {
  BTC: PriceHistoryPoint[];
  ETH: PriceHistoryPoint[];
}

const { ipcRenderer } = window.require('electron');

const PriceWidget: React.FC = () => {
  const [prices, setPrices] = useState<PriceState>({
    BTC: null,
    ETH: null
  });

  const [priceHistory, setPriceHistory] = useState<HistoryState>({
    BTC: [],
    ETH: []
  });

  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);

  // Load historical data on component mount
  useEffect(() => {
    const loadHistoricalData = async () => {
      console.log('Loading historical data...');

      const symbols = ['BTCUSDT', 'ETHUSDT'];
      const now = Date.now();
      const historyStartTime = now - CALCULATED_CONFIG.HISTORY_MS;

      for (const symbol of symbols) {
        try {
          // Binance Klines API for configured interval and history duration
          const response = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${CHART_CONFIG.BINANCE_INTERVAL}&startTime=${historyStartTime}&limit=${CALCULATED_CONFIG.MAX_DATA_POINTS}`
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
              [symbol.replace('USDT', '')]: historicalPoints
            }));
          }
        } catch (error) {
          console.error(`Failed to load historical data for ${symbol}:`, error);
        }
      }
    };

    loadHistoricalData();
  }, []); // Only run once on mount

  useEffect(() => {
    const handlePriceUpdate = (event: any, data: { symbol: string; data: PriceData }) => {
      const symbol = data.symbol as keyof PriceState;
      const price = parseFloat(data.data.price);
      const timestamp = data.data.timestamp;

      // Update current price
      setPrices(prev => ({
        ...prev,
        [symbol]: data.data
      }));

      // Update price history with smart frequency control
      setPriceHistory(prev => {
        const currentHistory = prev[symbol];
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
    return `$${parseFloat(price).toLocaleString()}`;
  };

  const handleCoinClick = (symbol: string) => {
    console.log('Current selected:', selectedCoin);
    const newSelection = selectedCoin === symbol ? null : symbol;
    setSelectedCoin(newSelection);
  };

  // Auto-resize window when chart is shown/hidden
  useEffect(() => {
    const resizeWindow = () => {
      // Base dimensions for price display only
      const baseWidth = 300;
      const baseHeight = 120;

      // Additional height when chart is shown
      const chartHeight = selectedCoin ? CHART_CONFIG.CHART_HEIGHT + 80 : 0; // +80 for padding and header

      const newWidth = selectedCoin ? 400 : baseWidth; // Wider when chart is shown
      const newHeight = baseHeight + chartHeight + 12;

      console.log(`Auto-resizing window: ${selectedCoin ? 'showing' : 'hiding'} chart`);
      console.log(`New dimensions: ${newWidth}x${newHeight}`);

      // Send resize request to main process
      ipcRenderer.send('resize-window', { width: newWidth, height: newHeight });
    };

    // Resize after a short delay to allow DOM updates
    const timeoutId = setTimeout(resizeWindow, 100);

    return () => clearTimeout(timeoutId);
  }, [selectedCoin]); // Trigger when selectedCoin changes

  // Set initial window size on component mount
  useEffect(() => {
    const setInitialSize = () => {
      const baseWidth = 300;
      const baseHeight = 120;
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
          <button className="control-btn minimize-btn" onClick={handleMinimize}>
            −
          </button>
          <button className="control-btn close-btn" onClick={handleClose}>
            ×
          </button>
        </div>
      </div>

      <div className="price-list">
        <div
          className={`price-item clickable ${selectedCoin === 'BTC' ? 'active' : ''}`}
          onClick={() => handleCoinClick('BTC')}
        >
          <span className="coin-symbol">BTC</span>
          <span className={`coin-price btc-price ${!prices.BTC ? 'loading' : ''}`}>
            {formatPrice(prices.BTC?.price)}
          </span>
        </div>

        <div
          className={`price-item clickable ${selectedCoin === 'ETH' ? 'active' : ''}`}
          onClick={() => handleCoinClick('ETH')}
        >
          <span className="coin-symbol">ETH</span>
          <span className={`coin-price eth-price ${!prices.ETH ? 'loading' : ''}`}>
            {formatPrice(prices.ETH?.price)}
          </span>
        </div>
      </div>

      {selectedCoin && (
        <PriceChart
          data={priceHistory[selectedCoin as keyof HistoryState]}
          symbol={selectedCoin}
          color={selectedCoin === 'BTC' ? '#f7931a' : '#627eea'}
        />
      )}
    </div>
  );
};

export default PriceWidget;