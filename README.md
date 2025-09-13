# CoinWidget2

A Windows desktop widget that displays real-time cryptocurrency prices for Bitcoin (BTC) and Ethereum (ETH) using Electron and React.

## Features

- Real-time price updates from Binance API
- Always-on-top floating window
- Clean, minimal UI design
- Windows system tray integration
- Draggable widget interface

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd CoinWidget2
```

2. Install dependencies:
```bash
npm install
```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

### Create Distributable
```bash
npm run dist
```

## Project Structure

```
CoinWidget2/
├── src/
│   ├── main/
│   │   └── main.ts          # Electron main process
│   ├── renderer/
│   │   ├── components/
│   │   │   └── PriceWidget.tsx  # Main UI component
│   │   ├── styles/
│   │   │   └── app.css          # Styling
│   │   ├── App.tsx              # React root component
│   │   ├── index.tsx            # React entry point
│   │   └── index.html           # HTML template
│   └── shared/
│       └── types.ts             # TypeScript type definitions
├── dist/                        # Compiled output
├── package.json                 # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── webpack.config.js           # Webpack build configuration
└── electron-builder.json      # Electron packaging configuration
```

## Requirements

- Node.js 16 or higher
- Windows 10/11
- Internet connection for price data

## Technologies Used

- **Electron**: Desktop app framework
- **React**: UI library
- **TypeScript**: Type-safe JavaScript
- **Webpack**: Module bundler
- **Binance WebSocket API**: Real-time price data

## Build Scripts

- `npm run build` - Build the application
- `npm start` - Build and run the application
- `npm run dev` - Build and run in development mode
- `npm run pack` - Package the application
- `npm run dist` - Build and create distributable

## License

ISC