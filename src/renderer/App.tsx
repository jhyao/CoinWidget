import React from 'react';
import PriceWidget from './components/PriceWidget';
import './styles/app.css';

const App: React.FC = () => {
  return (
    <div className="app">
      <PriceWidget />
    </div>
  );
};

export default App;