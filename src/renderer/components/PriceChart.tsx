import React, { useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { PriceHistoryPoint } from '../../shared/types';
import { CHART_CONFIG } from '../../shared/config';

interface PriceChartProps {
  data: PriceHistoryPoint[];
  symbol: string;
  color: string;
}

const PriceChart: React.FC<PriceChartProps> = React.memo(({ data, symbol, color }) => {
  const [hoveredData, setHoveredData] = useState<{ price: number; time: string } | null>(null);

  const getDisplayName = (symbol: string): string => {
    const binanceSymbol = symbol.replace('PERP', '');
    return binanceSymbol.replace('USDT', '');
  };

  const getMarketType = (symbol: string): 'SPOT' | 'PERP' => {
    return symbol.includes('PERP') ? 'PERP' : 'SPOT';
  };

  const formatPrice = (price: number) => {
    const decimals = price > 1000 ? 2 : price > 1 ? 3 : 6;
    return `$${price.toFixed(decimals)}`;
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  // Custom tooltip component that captures hover data and renders nothing
  const CustomTooltip = ({ active, payload, label }: any) => {
    // Don't use useEffect inside the tooltip - it causes infinite re-renders
    // Instead, set state directly during render (which is safe for this case)
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      // Only update if the data has actually changed to prevent infinite loops
      if (!hoveredData || hoveredData.price !== data.price || hoveredData.time !== formatTime(data.timestamp)) {
        setTimeout(() => {
          setHoveredData({
            price: data.price,
            time: formatTime(data.timestamp)
          });
        }, 0);
      }
    } else if (hoveredData !== null) {
      setTimeout(() => {
        setHoveredData(null);
      }, 0);
    }

    return null;
  };

  // Calculate dynamic Y-axis domain for better visualization
  const calculateYDomain = (data: PriceHistoryPoint[]) => {
    if (data.length === 0) return [0, 100];

    const prices = data.map(d => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    // Calculate range and add padding
    const range = max - min;
    const padding = Math.max(range * 0.1, 0.01); // 10% padding or at least $0.01

    return [min - padding, max + padding];
  };

  if (data.length === 0) {
    return (
      <div className="chart-placeholder">
        <p>Loading {getDisplayName(symbol)} chart...</p>
      </div>
    );
  }

  const marketType = getMarketType(symbol);
  const displayName = getDisplayName(symbol);

  return (
    <div className="chart-container">
      <div className="chart-header">
        <div className="chart-title">
          <h4>
            {displayName}
            {marketType === 'PERP' && (
              <span className="market-badge" style={{
                marginLeft: '6px',
                fontSize: '10px',
                padding: '2px 5px',
                backgroundColor: '#FF6B00',
                color: '#fff',
                borderRadius: '3px',
                fontWeight: 'bold',
                verticalAlign: 'middle'
              }}>
                PERP
              </span>
            )}
            {' '}({CHART_CONFIG.HISTORY_HOURS} hours)
          </h4>
        </div>
        {hoveredData ? (
          <div className="chart-hover-info">
            <span className="hover-price" style={{ color }}>{formatPrice(hoveredData.price)}</span>
            <span className="hover-time">{hoveredData.time}</span>
          </div>
        ) : (
          <div className="chart-hover-info">
            <span className="hover-price" style={{ color }}>{formatPrice(data[data.length - 1]?.price || 0)}</span>
            <span className="hover-time">{formatTime(data[data.length - 1]?.timestamp || Date.now())}</span>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={CHART_CONFIG.CHART_HEIGHT}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
        >
          <XAxis
            dataKey="timestamp"
            tick={false}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={calculateYDomain(data)}
            scale="linear"
            tick={false}
            axisLine={false}
            tickLine={false}
            width={0}
          />
          <Tooltip
            content={CustomTooltip}
            cursor={{
              stroke: color,
              strokeWidth: 1,
              strokeDasharray: '3 3'
            }}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 6,
              fill: color,
              stroke: 'white',
              strokeWidth: 2,
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
            }}
            animationDuration={100}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

export default PriceChart;