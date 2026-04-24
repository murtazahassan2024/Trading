let lev = 1;
let chart = null;
let volumeChart = null;
let rsiChart = null;
let macdChart = null;
let alertLog = [];
let lastRSI = null, lastCons = null;
let fundingTimer = null;
let scanTimer = null;
let paperTrade = null;
let paperTrades = [];
let paperLedger = [];
let autoPaper = false;
let lastAutoActionAt = 0;
let lastSignalSnapshot = null;
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
const SCAN_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT','LTCUSDT'];

const BOOKS = [
  {title:'Technical Analysis of the Financial Markets', author:'J. Murphy', strat:'Trend + momentum', color:'#00e5a0'},
  {title:'Trading in the Zone', author:'M. Douglas', strat:'Discipline filter', color:'#7b6fff'},
  {title:'Japanese Candlestick Charting Techniques', author:'S. Nison', strat:'Candle reversal', color:'#f5c842'},
  {title:'High Probability Trading Strategies', author:'R. Miner', strat:'Momentum retrace', color:'#ff4d6d'},
  {title:'Trading for a Living', author:'A. Elder', strat:'Triple Screen', color:'#00c2ff'},
  {title:'Market Wizards', author:'J. Schwager', strat:'Trend Follow', color:'#ff9f40'}
];
