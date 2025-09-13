export interface PriceData {
  symbol: string;
  price: string;
  priceChangePercent: string;
  timestamp: number;
}

export interface PriceHistoryPoint {
  timestamp: number;
  price: number;
  time: string;
}

export interface CoinPrice {
  [symbol: string]: PriceData;
}

export interface CoinHistory {
  [symbol: string]: PriceHistoryPoint[];
}

export interface WindowMessage {
  type: 'PRICE_UPDATE';
  payload: CoinPrice;
}

export interface BinanceSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}