import React, { useState, useEffect } from 'react';
import { PriceData } from '../../shared/types';

interface PriceState {
  BTC: PriceData | null;
  ETH: PriceData | null;
}

const { ipcRenderer } = window.require('electron');

const PriceWidget: React.FC = () => {
  const [prices, setPrices] = useState<PriceState>({
    BTC: null,
    ETH: null
  });

  useEffect(() => {
    const handlePriceUpdate = (event: any, data: { symbol: string; data: PriceData }) => {
      setPrices(prev => ({
        ...prev,
        [data.symbol]: data.data
      }));
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
        <div className="price-item">
          <span className="coin-symbol">BTC</span>
          <span className={`coin-price btc-price ${!prices.BTC ? 'loading' : ''}`}>
            {formatPrice(prices.BTC?.price)}
          </span>
        </div>

        <div className="price-item">
          <span className="coin-symbol">ETH</span>
          <span className={`coin-price eth-price ${!prices.ETH ? 'loading' : ''}`}>
            {formatPrice(prices.ETH?.price)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default PriceWidget;