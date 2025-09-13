import React from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { PriceHistoryPoint } from '../../shared/types';
import { CHART_CONFIG } from '../../shared/config';

interface PriceChartProps {
  data: PriceHistoryPoint[];
  symbol: string;
  color: string;
}

const PriceChart: React.FC<PriceChartProps> = React.memo(({ data, symbol, color }) => {
  const formatTooltipValue = (value: any) => {
    const price = parseFloat(value);
    // Show appropriate decimal places based on price range
    const decimals = price > 1000 ? 2 : price > 1 ? 3 : 6;
    return [`$${price.toFixed(decimals)}`];
  };

  const formatTooltipLabel = (label: any) => {
    const date = new Date(label);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
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
        <p>Loading {symbol} chart...</p>
      </div>
    );
  }

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h4>{symbol} Price Chart ({CHART_CONFIG.HISTORY_HOURS} hours)</h4>
      </div>
      <ResponsiveContainer width="100%" height={CHART_CONFIG.CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
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
            formatter={formatTooltipValue}
            labelFormatter={formatTooltipLabel}
            contentStyle={{
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              border: `2px solid ${color}`,
              borderRadius: '8px',
              color: 'white',
              fontSize: '10px',
              padding: '8px 12px'
            }}
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