export interface PriceData {
  symbol: string;
  price: string;
  timestamp: number;
}

export interface PriceHistoryPoint {
  timestamp: number;
  price: number;
  time: string;
}

export interface CoinPrice {
  BTC: PriceData;
  ETH: PriceData;
}

export interface CoinHistory {
  BTC: PriceHistoryPoint[];
  ETH: PriceHistoryPoint[];
}

export interface WindowMessage {
  type: 'PRICE_UPDATE';
  payload: CoinPrice;
}