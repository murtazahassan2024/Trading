let chart = null;
let volumeChart = null;
let rsiChart = null;
let macdChart = null;
let tradeDetailChart = null;
let tradeDetailChartToken = 0;
let alertLog = [];
let lastRSI = null, lastCons = null;
let fundingTimer = null;
let scanTimer = null;
let currentFundingRate = null;
let paperTrade = null;
let paperTrades = [];
let paperLedger = [];
let autoPaper = false;
let autoScout = false;
let lastScoutActionAt = 0;
let lastAutoActionAt = 0;
let lastSignalSnapshot = null;
let lastScannerRows = [];
let audioCtx = null;
let activeTradeId = null;

function syncPaperTradeSelection() {
  if (!Array.isArray(paperTrades)) paperTrades = [];
  if (activeTradeId) {
    paperTrade = paperTrades.find(trade => trade.tradeId === activeTradeId) || null;
  }
  if (!paperTrade && paperTrades.length) {
    paperTrade = paperTrades[0];
    activeTradeId = paperTrade.tradeId;
  }
  if (!paperTrades.length) {
    paperTrade = null;
    activeTradeId = null;
  }
  if (paperTrade) activeTradeId = paperTrade.tradeId;
  return paperTrade;
}

const K = { o:[], h:[], l:[], c:[], v:[], t:[], labels:[] };
const MAX = 200;
const candles4h = [];
const candles1h = [];
const candles15m = [];
const MTF_MAX = 60;
const SCAN_SYMBOLS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT','LTCUSDT',
  'SUIUSDT','APTUSDT','NEARUSDT','OPUSDT','ARBUSDT','INJUSDT','SEIUSDT','WIFUSDT',
  '1000PEPEUSDT','1000BONKUSDT','1000SHIBUSDT','TIAUSDT','WLDUSDT','ENAUSDT',
  'FILUSDT','DOTUSDT','UNIUSDT','AAVEUSDT','ATOMUSDT'
];

const BOOKS = [
  {title:'Technical Analysis of the Financial Markets', author:'J. Murphy', strat:'Trend + momentum', color:'#00e5a0'},
  {title:'Trading in the Zone', author:'M. Douglas', strat:'Discipline filter', color:'#7b6fff'},
  {title:'Japanese Candlestick Charting Techniques', author:'S. Nison', strat:'Candle reversal', color:'#f5c842'},
  {title:'High Probability Trading Strategies', author:'R. Miner', strat:'Momentum retrace', color:'#ff4d6d'},
  {title:'Trading for a Living', author:'A. Elder', strat:'Triple Screen', color:'#00c2ff'},
  {title:'Market Wizards', author:'J. Schwager', strat:'Trend Follow', color:'#ff9f40'},
  {title:'Bollinger on Bollinger Bands', author:'J. Bollinger', strat:'Band + momentum', color:'#38bdf8'},
  {title:'Encyclopedia of Chart Patterns', author:'T. Bulkowski', strat:'Pattern breakout', color:'#22c55e'}
];
