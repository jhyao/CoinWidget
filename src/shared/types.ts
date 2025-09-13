export interface PriceData {
  symbol: string;
  price: string;
  timestamp: number;
}

export interface CoinPrice {
  BTC: PriceData;
  ETH: PriceData;
}

export interface WindowMessage {
  type: 'PRICE_UPDATE';
  payload: CoinPrice;
}