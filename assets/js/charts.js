const candlePlugin = {
  id: 'signalosCandles',
  beforeDatasetsDraw(chart) {
    if (!K.c.length) return;
    const {ctx, chartArea, scales} = chart;
    if (!chartArea) return;
    const start = Math.max(0, K.c.length - 80);
    const candles = K.c.slice(start).map((close, i)=>({
      open: K.o[start+i],
      high: K.h[start+i],
      low: K.l[start+i],
      close,
    }));
    const width = Math.max(3, (chartArea.right-chartArea.left)/Math.max(candles.length,1)*.58);
    ctx.save();
    candles.forEach((k,i)=>{
      const x = scales.x.getPixelForValue(i);
      const yOpen = scales.y.getPixelForValue(k.open);
      const yClose = scales.y.getPixelForValue(k.close);
      const yHigh = scales.y.getPixelForValue(k.high);
      const yLow = scales.y.getPixelForValue(k.low);
      const up = k.close >= k.open;
      const color = up ? cssVar('--accent') : cssVar('--accent2');
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();
      const top = Math.min(yOpen, yClose);
      const body = Math.max(2, Math.abs(yClose-yOpen));
      ctx.globalAlpha = up ? .72 : .78;
      ctx.fillRect(x-width/2, top, width, body);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }
};

if (window.Chart) Chart.register(candlePlugin);

function renderChart() {
  const labels=K.labels.slice(-80), prices=K.c.slice(-80);
  if(chart){
    chart.data.labels=labels;
    chart.data.datasets[0].data=prices;
    syncTradeChartLines();
    chart.update('none');
    renderLowerCharts();
    return;
  }
  chart=new Chart(document.getElementById('priceChart'),{
    type:'line',
    data:{labels,datasets:[
      {label:'Close scale',data:prices,borderColor:'transparent',borderWidth:0,pointRadius:0,tension:0,fill:false},
      {label:'Entry',data:[],borderColor:'#f5c842',borderWidth:1,borderDash:[5,5],pointRadius:0},
      {label:'Stop',data:[],borderColor:'#ff4d6d',borderWidth:1,borderDash:[4,4],pointRadius:0},
      {label:'Target',data:[],borderColor:'#00e5a0',borderWidth:1,borderDash:[4,4],pointRadius:0}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>'$'+c.parsed.y.toLocaleString(undefined,{maximumFractionDigits:4})},backgroundColor:'#1c1c2a',borderColor:'#2a2a3d',borderWidth:1}},
      scales:{
        x:{ticks:{color:'#7a7a9a',font:{size:9},maxTicksLimit:10},grid:{color:'rgba(255,255,255,.04)'}},
        y:{ticks:{color:'#7a7a9a',font:{size:9},callback:(v)=>'$'+v.toLocaleString(undefined,{maximumFractionDigits:2})},grid:{color:'rgba(255,255,255,.04)'}}
      }
    }
  });
  syncTradeChartLines();
  renderLowerCharts();
}

function baseMiniChartOptions() {
  return {
    responsive:true,
    maintainAspectRatio:false,
    animation:false,
    plugins:{legend:{display:false},tooltip:{backgroundColor:cssVar('--surface2'),borderColor:cssVar('--border'),borderWidth:1}},
    scales:{
      x:{ticks:{display:false},grid:{color:cssVar('--chart-grid')}},
      y:{ticks:{color:cssVar('--muted'),font:{size:9},maxTicksLimit:4},grid:{color:cssVar('--chart-grid')}}
    }
  };
}

function renderLowerCharts() {
  const labels=K.labels.slice(-80);
  const closes=K.c.slice(-80);
  const vols=K.v.slice(-80);
  const colors=closes.map((c,i)=>i===0||c>=K.o.slice(-80)[i] ? cssVar('--accent') : cssVar('--accent2'));
  const rsiVals=rsiSeries(K.c).slice(-80);
  const macdVals=macdSeries(K.c).slice(-80);

  if(!volumeChart){
    volumeChart=new Chart(document.getElementById('volumeChart'),{
      type:'bar',
      data:{labels,datasets:[{data:vols,backgroundColor:colors,borderWidth:0}]},
      options:baseMiniChartOptions()
    });
  } else {
    volumeChart.data.labels=labels;
    volumeChart.data.datasets[0].data=vols;
    volumeChart.data.datasets[0].backgroundColor=colors;
    volumeChart.update('none');
  }

  if(!rsiChart){
    rsiChart=new Chart(document.getElementById('rsiChart'),{
      type:'line',
      data:{labels,datasets:[
        {data:rsiVals,borderColor:cssVar('--gold'),borderWidth:1.5,pointRadius:0,tension:.2},
        {data:new Array(labels.length).fill(70),borderColor:cssVar('--accent2'),borderWidth:1,borderDash:[3,3],pointRadius:0},
        {data:new Array(labels.length).fill(30),borderColor:cssVar('--accent'),borderWidth:1,borderDash:[3,3],pointRadius:0}
      ]},
      options:{...baseMiniChartOptions(),scales:{...baseMiniChartOptions().scales,y:{...baseMiniChartOptions().scales.y,min:0,max:100}}}
    });
  } else {
    rsiChart.data.labels=labels;
    rsiChart.data.datasets[0].data=rsiVals;
    rsiChart.data.datasets[1].data=new Array(labels.length).fill(70);
    rsiChart.data.datasets[2].data=new Array(labels.length).fill(30);
    rsiChart.update('none');
  }

  if(!macdChart){
    macdChart=new Chart(document.getElementById('macdChart'),{
      type:'bar',
      data:{labels,datasets:[{data:macdVals,backgroundColor:macdVals.map(v=>v>=0?cssVar('--accent'):cssVar('--accent2')),borderWidth:0}]},
      options:baseMiniChartOptions()
    });
  } else {
    macdChart.data.labels=labels;
    macdChart.data.datasets[0].data=macdVals;
    macdChart.data.datasets[0].backgroundColor=macdVals.map(v=>v>=0?cssVar('--accent'):cssVar('--accent2'));
    macdChart.update('none');
  }
}

function updateChartTheme() {
  if (!chart) return;
  const grid = cssVar('--chart-grid');
  const muted = cssVar('--muted');
  const accent3 = cssVar('--accent3');
  const surface2 = cssVar('--surface2');
  const border = cssVar('--border');
  chart.data.datasets[0].borderColor = 'transparent';
  chart.data.datasets[0].backgroundColor = 'transparent';
  chart.options.plugins.tooltip.backgroundColor = surface2;
  chart.options.plugins.tooltip.borderColor = border;
  chart.options.scales.x.ticks.color = muted;
  chart.options.scales.x.grid.color = grid;
  chart.options.scales.y.ticks.color = muted;
  chart.options.scales.y.grid.color = grid;
  chart.update('none');
  [volumeChart,rsiChart,macdChart].forEach(c=>{
    if(!c) return;
    c.options.plugins.tooltip.backgroundColor=surface2;
    c.options.plugins.tooltip.borderColor=border;
    c.options.scales.x.grid.color=grid;
    c.options.scales.y.grid.color=grid;
    c.options.scales.y.ticks.color=muted;
    c.update('none');
  });
}

function syncTradeChartLines() {
  if (!chart) return;
  const len = chart.data.labels.length;
  const empty = new Array(len).fill(null);
  chart.data.datasets[1].data = paperTrade ? new Array(len).fill(paperTrade.entry) : empty;
  chart.data.datasets[2].data = paperTrade ? new Array(len).fill(paperTrade.stop) : empty;
  chart.data.datasets[3].data = paperTrade ? new Array(len).fill(paperTrade.target) : empty;
}
