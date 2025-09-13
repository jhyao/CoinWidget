import React, { useState, useEffect } from 'react';
import { PriceData, PriceHistoryPoint } from '../../shared/types';
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

      // Add to price history (keep last 50 points for 5-minute chart)
      setPriceHistory(prev => {
        const newHistory = [...prev[symbol]];
        newHistory.push({
          timestamp,
          price,
          time: new Date(timestamp).toLocaleTimeString()
        });

        // Keep only last 50 points (about 5 minutes at 6-second intervals)
        if (newHistory.length > 50) {
          newHistory.shift();
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
    setSelectedCoin(selectedCoin === symbol ? null : symbol);
  };

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