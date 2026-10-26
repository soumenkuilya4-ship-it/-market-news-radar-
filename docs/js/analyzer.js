// Market Radar analysis engine.
// Pure ES module with no dependencies: the Node server imports it for feed items,
// and the browser imports it to analyse manual posts when no server is reachable.

export const ASSET_CLASSES = ['Equities', 'Commodities', 'Macro', 'Geopolitics'];
export const IMPACTS = ['High', 'Medium', 'Low'];
export const SENTIMENTS = ['Bullish', 'Bearish', 'Neutral'];

// ---------------------------------------------------------------------------
// Dictionaries
// ---------------------------------------------------------------------------

const ASSET_KEYWORDS = {
  Commodities: [
    'gold', 'silver', 'crude', 'brent', 'wti', 'oil price', 'natural gas', 'copper', 'aluminium',
    'aluminum', 'zinc', 'nickel', 'lead price', 'mcx', 'comex', 'lme', 'bullion', 'commodity',
    'commodities', 'opec', 'iron ore', 'steel price', 'coal price', 'cotton', 'sugar price',
    'wheat', 'soybean', 'palm oil', 'crop', 'kharif', 'rabi', 'monsoon', 'platinum', 'palladium',
    'barrel', 'ounce', 'futures',
  ],
  Macro: [
    'rbi', 'reserve bank', 'repo rate', 'reverse repo', 'monetary policy', 'mpc', 'inflation',
    'cpi', 'wpi', 'gdp', 'iip', 'fiscal deficit', 'current account', 'trade deficit', 'forex reserves',
    'rupee', 'bond yield', 'g-sec', 'treasury', 'federal reserve', 'fed', 'fomc', 'ecb', 'bank of japan',
    'interest rate', 'rate cut', 'rate hike', 'liquidity', 'crr', 'slr', 'pmi', 'gst collection',
    'budget', 'finance ministry', 'unemployment', 'payrolls', 'money supply', 'external debt',
    'government securities', 'auction', 'press release', 'circular', 'sovereign',
  ],
  Geopolitics: [
    'war', 'sanction', 'tariff', 'conflict', 'missile', 'military', 'border', 'invasion', 'ceasefire',
    'geopolitical', 'geopolitics', 'russia', 'russian', 'ukraine', 'ukrainian', 'israel', 'israeli', 'iran', 'iranian',
    'gaza', 'taiwan', 'north korea', 'nato', 'pakistan', 'china-taiwan',
    'terror', 'attack', 'embargo', 'trade war', 'diplomatic', 'red sea', 'strait of hormuz', 'houthi',
    'election', 'coup', 'unrest', 'retaliation', 'retaliate', 'retaliatory',
  ],
};

// Sub-sectors: first match by score wins. `asset` is the class the sub-sector implies.
const SUBSECTORS = [
  { name: 'Central Bank', asset: 'Macro', kw: ['rbi', 'reserve bank', 'repo', 'monetary policy', 'mpc', 'federal reserve', 'fomc', 'ecb', 'central bank', 'governor', 'crr', 'slr', 'liquidity adjustment', 'payment system', 'regulatory'] },
  { name: 'Inflation & Growth', asset: 'Macro', kw: ['inflation', 'cpi', 'wpi', 'gdp', 'iip', 'pmi', 'growth rate', 'unemployment', 'payrolls'] },
  { name: 'Fiscal & Govt', asset: 'Macro', kw: ['fiscal', 'budget', 'gst', 'tax', 'finance ministry', 'disinvestment', 'government borrowing', 'subsidy'] },
  { name: 'Currency & Rates', asset: 'Macro', kw: ['rupee', 'usd/inr', 'forex', 'bond yield', 'g-sec', 'treasury', 'government securities', 'dollar index', 'yield'] },
  { name: 'Trade & Tariffs', asset: 'Geopolitics', kw: ['tariff', 'trade war', 'trade deal', 'export ban', 'import duty', 'anti-dumping', 'embargo', 'sanction'] },
  { name: 'Conflict & Security', asset: 'Geopolitics', kw: ['war', 'missile', 'military', 'conflict', 'ceasefire', 'attack', 'terror', 'invasion', 'border'] },
  { name: 'Precious Metals', asset: 'Commodities', kw: ['gold', 'silver', 'bullion', 'platinum', 'palladium'] },
  { name: 'Energy', asset: 'Commodities', kw: ['crude', 'brent', 'wti', 'oil', 'natural gas', 'lng', 'opec', 'refinery', 'refining', 'refiner', 'petrol', 'diesel', 'ongc', 'reliance', 'bpcl', 'hpcl', 'ioc', 'gail', 'power', 'ntpc', 'renewable', 'solar', 'coal'] },
  { name: 'Metals', asset: 'Commodities', kw: ['copper', 'aluminium', 'aluminum', 'zinc', 'nickel', 'steel', 'iron ore', 'tata steel', 'jsw steel', 'hindalco', 'vedanta', 'sail', 'nmdc', 'metal', 'mining'] },
  { name: 'Agri', asset: 'Commodities', kw: ['wheat', 'rice', 'sugar', 'cotton', 'soybean', 'palm oil', 'crop', 'kharif', 'rabi', 'monsoon', 'fertiliser', 'fertilizer', 'agri'] },
  { name: 'Banking', asset: 'Equities', kw: ['bank', 'hdfc bank', 'icici', 'sbi', 'axis bank', 'kotak', 'indusind', 'npa', 'loan growth', 'deposit', 'lender', 'credit growth', 'casa'] },
  { name: 'NBFC & Financials', asset: 'Equities', kw: ['nbfc', 'bajaj finance', 'insurance', 'amc', 'mutual fund', 'broker', 'fintech', 'microfinance', 'housing finance', 'lic', 'sebi'] },
  { name: 'IT & Tech', asset: 'Equities', kw: ['infosys', 'tcs', 'wipro', 'hcl tech', 'tech mahindra', 'software', 'it services', 'ai', 'artificial intelligence', 'semiconductor', 'saas', 'cloud', 'digital'] },
  { name: 'Auto', asset: 'Equities', kw: ['auto', 'car', 'vehicle', 'ev', 'electric vehicle', 'two-wheeler', 'maruti', 'tata motors', 'mahindra', 'bajaj auto', 'hero motocorp', 'eicher', 'tvs motor', 'tyre', 'sales volume'] },
  { name: 'Pharma & Healthcare', asset: 'Equities', kw: ['pharma', 'drug', 'usfda', 'fda', 'sun pharma', 'cipla', "dr reddy", 'lupin', 'hospital', 'healthcare', 'vaccine', 'api', 'biocon', 'divi'] },
  { name: 'FMCG & Consumer', asset: 'Equities', kw: ['fmcg', 'hindustan unilever', 'hul', 'itc', 'nestle', 'britannia', 'dabur', 'consumer', 'retail', 'titan', 'jewellery', 'rural demand'] },
  { name: 'Telecom & Media', asset: 'Equities', kw: ['telecom', 'airtel', 'jio', 'vodafone idea', 'spectrum', 'tariff hike', '5g', 'media', 'broadcast'] },
  { name: 'Infra & Capital Goods', asset: 'Equities', kw: ['infra', 'larsen', 'l&t', 'order win', 'order book', 'capex', 'cement', 'ultratech', 'construction', 'railway', 'defence', 'hal', 'bel', 'road', 'port', 'adani ports'] },
  { name: 'Realty', asset: 'Equities', kw: ['real estate', 'realty', 'housing sales', 'dlf', 'godrej properties', 'property'] },
  { name: 'Aviation & Logistics', asset: 'Equities', kw: ['airline', 'aviation', 'indigo', 'interglobe', 'air india', 'logistics', 'shipping', 'freight'] },
  { name: 'Corporate Action', asset: 'Equities', kw: ['dividend', 'bonus', 'split', 'buyback', 'board meeting', 'record date', 'allotment', 'agm', 'egm', 'outcome of board', 'intimation', 'disclosure', 'regulation 30', 'shareholding'] },
  { name: 'Markets', asset: 'Equities', kw: ['sensex', 'nifty', 'stock market', 'markets', 'shares', 'equity', 'ipo', 'fii', 'dii', 'fpi'] },
];

// Known instruments: [display, TradingView symbol, ...aliases]
const INSTRUMENTS = [
  ['NIFTY 50', 'NSE:NIFTY', 'nifty 50', 'nifty50', 'nifty'],
  ['SENSEX', 'BSE:SENSEX', 'sensex'],
  ['BANK NIFTY', 'NSE:BANKNIFTY', 'bank nifty', 'banknifty', 'nifty bank'],
  ['NIFTY IT', 'NSE:CNXIT', 'nifty it'],
  ['INDIA VIX', 'NSE:INDIAVIX', 'india vix', 'vix'],
  ['GOLD', 'TVC:GOLD', 'gold'],
  ['SILVER', 'TVC:SILVER', 'silver'],
  ['BRENT', 'TVC:UKOIL', 'brent'],
  ['WTI CRUDE', 'TVC:USOIL', 'wti', 'crude oil', 'crude'],
  ['NATURAL GAS', 'NYMEX:NG1!', 'natural gas'],
  ['COPPER', 'COMEX:HG1!', 'copper'],
  ['USD/INR', 'FX_IDC:USDINR', 'rupee', 'usd/inr', 'usdinr'],
  ['DXY', 'TVC:DXY', 'dollar index', 'dxy'],
  ['IN 10Y', 'TVC:IN10Y', 'bond yield', '10-year', 'g-sec', 'benchmark yield'],
  ['US 10Y', 'TVC:US10Y', 'treasury yield', 'us 10-year'],
  ['RELIANCE', 'BSE:RELIANCE', 'reliance industries', 'reliance', 'ril'],
  ['TCS', 'BSE:TCS', 'tata consultancy', 'tcs'],
  ['INFY', 'BSE:INFY', 'infosys', 'infy'],
  ['HDFCBANK', 'BSE:HDFCBANK', 'hdfc bank'],
  ['ICICIBANK', 'BSE:ICICIBANK', 'icici bank', 'icici'],
  ['SBIN', 'BSE:SBIN', 'state bank of india', 'sbi'],
  ['AXISBANK', 'BSE:AXISBANK', 'axis bank'],
  ['KOTAKBANK', 'BSE:KOTAKBANK', 'kotak mahindra bank', 'kotak'],
  ['INDUSINDBK', 'BSE:INDUSINDBK', 'indusind'],
  ['BAJFINANCE', 'BSE:BAJFINANCE', 'bajaj finance'],
  ['LT', 'BSE:LT', 'larsen', 'l&t'],
  ['ITC', 'BSE:ITC', 'itc'],
  ['HINDUNILVR', 'BSE:HINDUNILVR', 'hindustan unilever', 'hul'],
  ['BHARTIARTL', 'BSE:BHARTIARTL', 'bharti airtel', 'airtel'],
  ['WIPRO', 'BSE:WIPRO', 'wipro'],
  ['HCLTECH', 'BSE:HCLTECH', 'hcl tech', 'hcltech', 'hcl technologies'],
  ['TECHM', 'BSE:TECHM', 'tech mahindra'],
  ['MARUTI', 'BSE:MARUTI', 'maruti'],
  ['TATAMOTORS', 'BSE:TATAMOTORS', 'tata motors'],
  ['M&M', 'BSE:M&M', 'mahindra & mahindra', 'mahindra and mahindra', 'm&m'],
  ['BAJAJ-AUTO', 'BSE:BAJAJ_AUTO', 'bajaj auto'],
  ['HEROMOTOCO', 'BSE:HEROMOTOCO', 'hero motocorp'],
  ['EICHERMOT', 'BSE:EICHERMOT', 'eicher'],
  ['SUNPHARMA', 'BSE:SUNPHARMA', 'sun pharma'],
  ['CIPLA', 'BSE:CIPLA', 'cipla'],
  ['DRREDDY', 'BSE:DRREDDY', "dr reddy", 'dr. reddy'],
  ['TATASTEEL', 'BSE:TATASTEEL', 'tata steel'],
  ['JSWSTEEL', 'BSE:JSWSTEEL', 'jsw steel'],
  ['HINDALCO', 'BSE:HINDALCO', 'hindalco'],
  ['VEDL', 'BSE:VEDL', 'vedanta'],
  ['COALINDIA', 'BSE:COALINDIA', 'coal india'],
  ['ONGC', 'BSE:ONGC', 'ongc'],
  ['BPCL', 'BSE:BPCL', 'bpcl', 'bharat petroleum'],
  ['IOC', 'BSE:IOC', 'indian oil'],
  ['NTPC', 'BSE:NTPC', 'ntpc'],
  ['POWERGRID', 'BSE:POWERGRID', 'power grid'],
  ['ADANIENT', 'BSE:ADANIENT', 'adani enterprises'],
  ['ADANIPORTS', 'BSE:ADANIPORTS', 'adani ports'],
  ['ULTRACEMCO', 'BSE:ULTRACEMCO', 'ultratech'],
  ['TITAN', 'BSE:TITAN', 'titan'],
  ['ASIANPAINT', 'BSE:ASIANPAINT', 'asian paints'],
  ['NESTLEIND', 'BSE:NESTLEIND', 'nestle india', 'nestle'],
  ['HAL', 'BSE:HAL', 'hindustan aeronautics', 'hal'],
  ['BEL', 'BSE:BEL', 'bharat electronics'],
  ['INDIGO', 'BSE:INDIGO', 'interglobe', 'indigo'],
  ['ZOMATO', 'BSE:ETERNAL', 'zomato', 'eternal'],
  ['PAYTM', 'BSE:PAYTM', 'paytm', 'one97'],
  ['LICI', 'BSE:LICI', 'lic', 'life insurance corporation'],
  ['DLF', 'BSE:DLF', 'dlf'],
  ['IDEA', 'BSE:IDEA', 'vodafone idea'],
];

// Proxies used for the "in focus" bullet when no instrument is named explicitly.
const SECTOR_PROXIES = {
  'Central Bank': ['BANK NIFTY', 'IN 10Y', 'USD/INR'],
  'Inflation & Growth': ['NIFTY 50', 'IN 10Y', 'USD/INR'],
  'Fiscal & Govt': ['NIFTY 50', 'IN 10Y'],
  'Currency & Rates': ['USD/INR', 'IN 10Y', 'DXY'],
  'Trade & Tariffs': ['NIFTY 50', 'USD/INR', 'NIFTY IT'],
  'Conflict & Security': ['BRENT', 'GOLD', 'INDIA VIX'],
  'Precious Metals': ['GOLD', 'SILVER', 'TITAN'],
  'Energy': ['BRENT', 'ONGC', 'RELIANCE'],
  'Metals': ['TATASTEEL', 'HINDALCO', 'COPPER'],
  'Agri': ['NIFTY 50'],
  'Banking': ['BANK NIFTY', 'HDFCBANK', 'ICICIBANK'],
  'NBFC & Financials': ['BAJFINANCE', 'BANK NIFTY'],
  'IT & Tech': ['NIFTY IT', 'TCS', 'INFY'],
  'Auto': ['MARUTI', 'TATAMOTORS', 'M&M'],
  'Pharma & Healthcare': ['SUNPHARMA', 'CIPLA', 'DRREDDY'],
  'FMCG & Consumer': ['HINDUNILVR', 'ITC', 'NESTLEIND'],
  'Telecom & Media': ['BHARTIARTL', 'IDEA'],
  'Infra & Capital Goods': ['LT', 'ULTRACEMCO', 'HAL'],
  'Realty': ['DLF'],
  'Aviation & Logistics': ['INDIGO', 'BRENT'],
  'Corporate Action': ['NIFTY 50'],
  'Markets': ['NIFTY 50', 'SENSEX', 'INDIA VIX'],
};

const HIGH_IMPACT = [
  'repo rate', 'rate cut', 'rate hike', 'cuts rate', 'hikes rate', 'monetary policy', 'policy rate',
  'emergency', 'war', 'invasion', 'missile', 'sanction', 'tariff', 'crash', 'plunge', 'plummet',
  'tumble', 'soar', 'skyrocket', 'record high', 'all-time high', 'lifetime high', 'record low',
  'circuit', 'default', 'bankrupt', 'insolvency', 'fraud', 'raid', 'merger', 'acquisition', 'acquire',
  'takeover', 'demerger', 'delist', 'sebi bans', 'sebi order', 'ban', 'downgrade', 'block deal',
  'opec cut', 'output cut', 'gdp', 'inflation', 'cpi', 'fomc', 'federal reserve', 'black swan',
  'resign', 'ceo quits', 'open offer', 'profit warning', 'guidance cut', 'lockdown', 'recession',
  'bloodbath', 'selloff', 'sell-off', 'biggest', 'strike', 'shutdown', 'penalty',
];
const MEDIUM_IMPACT = [
  'results', 'earnings', 'quarter', 'q1', 'q2', 'q3', 'q4', 'net profit', 'revenue', 'order',
  'contract', 'guidance', 'dividend', 'buyback', 'bonus', 'split', 'upgrade', 'target price', 'stake',
  'ipo', 'listing', 'fund raise', 'qip', 'rights issue', 'launch', 'expansion', 'capex', 'approval',
  'usfda', 'fii', 'fpi', 'outflow', 'inflow', 'rally', 'surge', 'jump', 'slump', 'fall', 'decline',
  'yield', 'rupee', 'auction', 'liquidity', 'appoint', 'board meeting', 'partnership', 'deal',
];

const BULLISH = [
  'surge', 'soar', 'jump', 'rally', 'gain', 'rise', 'rises', 'rose', 'climb', 'rising', 'higher', 'record high',
  'all-time high', 'beat', 'beats', 'outperform', 'upgrade', 'buy', 'strong', 'robust', 'growth',
  'profit rises', 'profit jumps', 'expands', 'expansion', 'order win', 'wins order', 'bags', 'secures',
  'approval', 'approves', 'rate cut', 'cuts rate', 'easing', 'boost', 'bullish', 'recovery', 'rebound',
  'optimism', 'upbeat', 'positive', 'dividend', 'buyback', 'bonus', 'inflow', 'accumulate', 'tailwind',
  'ceasefire', 'deal', 'beats estimates', 'better-than-expected', 'improve',
];
const BEARISH = [
  'fall', 'falls', 'fell', 'drop', 'drops', 'decline', 'slump', 'plunge', 'plummet', 'crash', 'tumble',
  'slide', 'sliding', 'lower', 'falling', 'slip', 'dip', 'sink', 'retreat', 'skid', 'loss', 'losses', 'miss', 'misses', 'downgrade', 'sell', 'weak', 'weakness',
  'concern', 'worry', 'fear', 'risk', 'pressure', 'cut guidance', 'guidance cut', 'rate hike', 'hikes rate',
  'tightening', 'inflation rises', 'sanction', 'tariff', 'war', 'attack', 'default', 'fraud', 'probe',
  'raid', 'penalty', 'ban', 'outflow', 'selloff', 'sell-off', 'bearish', 'slowdown', 'recession',
  'headwind', 'disappoint', 'below estimates', 'worse-than-expected', 'resign', 'layoff', 'strike', 'shutdown',
];
const NEGATORS = ['not ', 'no ', "n't ", 'despite ', 'fails to ', 'without '];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', hellip: '...', rupee: '₹' };

export function cleanText(input) {
  if (input == null) return '';
  let s = String(input);
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '. ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  s = s.replace(/&([a-z]+);/gi, (m, n) => ENTITY_MAP[n.toLowerCase()] ?? m);
  s = s.replace(/\s*\.\s*\.(\s*\.)*/g, '. ').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  return s.replace(/^[.\s]+/, '');
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Whole-word matcher that tolerates simple inflections (gain/gains/gained/gaining).
const reCache = new Map();
function wordRe(w) {
  let re = reCache.get(w);
  if (!re) {
    const k = w.trim().toLowerCase();
    re = new RegExp(`(?<![a-z0-9])${escapeRe(k)}(?:s|es|ed|d|ing)?(?![a-z0-9])`, 'g');
    reCache.set(w, re);
  }
  re.lastIndex = 0;
  return re;
}

function countHits(text, words) {
  let n = 0;
  const hits = [];
  for (const w of words) {
    if (wordRe(w).test(text)) { n++; hits.push(w.trim()); }
  }
  return { n, hits };
}

const instrumentMatchers = INSTRUMENTS.map(([name, tv, ...aliases]) => ({
  name,
  tv,
  re: new RegExp(`(^|[^a-z0-9&])(${aliases.map(escapeRe).join('|')})(?=$|[^a-z0-9&])`, 'i'),
}));
const instrumentByName = Object.fromEntries(INSTRUMENTS.map(([n, tv]) => [n, tv]));

// ---------------------------------------------------------------------------
// Stock universe (NIFTY 500 + Microcap 250 from NSE, loaded at runtime)
// ---------------------------------------------------------------------------

const INDUSTRY_SUBSECTOR = {
  'automobile and auto components': 'Auto',
  healthcare: 'Pharma & Healthcare',
  'information technology': 'IT & Tech',
  'metals & mining': 'Metals',
  'oil gas & consumable fuels': 'Energy',
  power: 'Energy',
  'fast moving consumer goods': 'FMCG & Consumer',
  'consumer durables': 'FMCG & Consumer',
  'consumer services': 'FMCG & Consumer',
  'capital goods': 'Infra & Capital Goods',
  construction: 'Infra & Capital Goods',
  'construction materials': 'Infra & Capital Goods',
  realty: 'Realty',
  telecommunication: 'Telecom & Media',
  'media entertainment & publication': 'Telecom & Media',
  chemicals: 'Chemicals',
  textiles: 'Textiles',
  'forest materials': 'Paper & Forest',
  'financial services': 'NBFC & Financials',
  // Categories used in the RS Scanner sheet
  'i.t': 'IT & Tech',
  fmcg: 'FMCG & Consumer',
  auto: 'Auto',
  financials: 'NBFC & Financials',
  bank: 'Banking',
  'aerospace & defence': 'Defence',
  industrials: 'Infra & Capital Goods',
  'consumer discretionary': 'FMCG & Consumer',
  'building materials': 'Infra & Capital Goods',
  'plastic products': 'Chemicals',
  'castings, forgings & fasteners': 'Infra & Capital Goods',
  transportation: 'Aviation & Logistics',
  services: 'Aviation & Logistics',
  'telecom-service': 'Telecom & Media',
  telecom: 'Telecom & Media',
  media: 'Telecom & Media',
  energy: 'Energy',
  utilities: 'Energy',
  'power & utilities': 'Energy',
  'readymade garments/apparels': 'Textiles',
};

// Trailing words dropped to build a short alias ("Reliance Industries" -> "Reliance").
const GENERIC_TAIL = new Set(['industries', 'industry', 'corporation', 'corp', 'company', 'co', 'enterprises', 'india', 'of', '(india)', 'limited', 'ltd', 'ltd.', '&']);
// One-word aliases that are too common, or are group names shared by many companies.
const SHORT_ALIAS_STOP = new Set([
  'bank', 'india', 'indian', 'national', 'united', 'power', 'energy', 'global', 'capital', 'finance', 'financial',
  'gold', 'metal', 'metals', 'steel', 'life', 'star', 'first', 'great', 'central', 'state', 'city', 'union',
  'general', 'home', 'house', 'prime', 'premier', 'super', 'supreme', 'standard', 'universal', 'popular', 'gateway',
  'ultra', 'infra', 'solar', 'green', 'royal', 'bharat', 'hindustan', 'tata', 'adani', 'bajaj', 'birla', 'aditya',
  'mahindra', 'godrej', 'jindal', 'hinduja', 'kotak', 'reliance', 'shriram', 'muthoot', 'oberoi', 'apollo', 'max',
  'future', 'network', 'motors', 'systems', 'solutions', 'technologies', 'holdings', 'investments', 'ventures',
  'housing', 'chemicals', 'pharmaceuticals', 'laboratories', 'cement', 'textiles', 'electricals', 'electronics',
  'engineering', 'infrastructure', 'healthcare', 'hospitals', 'foods', 'beverages', 'container', 'shipping', 'cables',
  'pipes', 'tyres', 'paints', 'sugar', 'exchange', 'insurance', 'securities', 'credit', 'trust', 'alpha', 'delta',
  'federal', 'eastern', 'western', 'southern', 'northern', 'oriental', 'continental', 'international', 'imperial',
  'persistent', 'prestige', 'phoenix', 'sterling', 'metropolis', 'vision', 'quality', 'premium', 'classic', 'modern',
  'gujarat', 'maharashtra', 'karnataka', 'punjab', 'kerala', 'bengal', 'rajasthan', 'mangalore', 'chennai', 'madras',
  'delhi', 'mumbai', 'bombay', 'calcutta', 'kolkata', 'hyderabad', 'bangalore', 'pune', 'andhra', 'orissa', 'odisha',
  'asian', 'american', 'british', 'japan', 'china', 'swiss', 'coal', 'cement', 'railway', 'indraprastha', 'nippon',
  'computer', 'digital', 'equity', 'money', 'motor', 'auto', 'avenue', 'century', 'garden', 'graphite', 'action',
  'swan', 'force', 'route', 'happiest', 'intellect', 'crompton',
]);
// Acronyms in capitals that are not stock symbols.
const SYMBOL_STOP = new Set(['RBI', 'GDP', 'CPI', 'WPI', 'USD', 'INR', 'IPO', 'CEO', 'CFO', 'COO', 'FII', 'DII', 'FPI', 'GST', 'EPS',
  'NSE', 'BSE', 'SEBI', 'NIFTY', 'MCX', 'AGM', 'EGM', 'ESG', 'LTD', 'THE', 'AND', 'FOR', 'NEW', 'ONE', 'ALL', 'CAN', 'NOT',
  'MPC', 'PMI', 'IIP', 'NPA', 'EBITDA', 'PAT', 'YOY', 'QOQ', 'USA', 'UAE', 'OPEC', 'IMF', 'WTO', 'EV', 'AI', 'IT',
  // Symbols that are ordinary English words
  'GLOBAL', 'STAR', 'BETA', 'ACE', 'ADVANCE', 'CLEAN', 'FACT', 'OMNI', 'MARINE', 'PRIORITY', 'LANDMARK', 'WHEELS',
  'FUSION', 'ROUTE', 'CORONA', 'CUPID', 'SIGNATURE', 'SAFARI', 'APOLLO', 'TIMEX', 'STANLEY', 'GENESYS', 'GARUDA',
  'INA', 'AYE', 'UDS', 'SUNSHINE', 'KNACK', 'ESTER', 'RAIN', 'RAINBOW', 'PRUDENT', 'CAMPUS', 'TRENT', 'AURUM',
  'JUNIPER', 'MARATHON', 'SATIN', 'BLS', 'OIL', 'EKC', 'WEL', 'DEEPA', 'TEGA', 'NAVA', 'ARIS', 'SAKAR',
  'PARAS', 'ANUP', 'AMBER', 'CERA', 'TATVA', 'STYL', 'JARO', 'ERIS']);
// Phrases that contain a listed company's name but mean something else.
const NAME_BLOCKERS = ['reserve bank of india', 'securities and exchange board of india', 'government of india', 'president of india', 'supreme court of india'];

let universe = { list: [], bySymbol: new Map(), nameRe: null, aliasTo: new Map(), firstRe: null, firstTo: new Map(), symbolRe: null };

function baseName(name) {
  return String(name).replace(/\s+/g, ' ').replace(/[\s,]*\b(limited|ltd)\.?\s*$/i, '').trim();
}

/** Text aliases a company is recognised by in news (lower-case). */
export function stockAliases(name) {
  const base = baseName(name).toLowerCase();
  if (!base) return [];
  const aliases = [base];
  if (base.includes(' and ')) aliases.push(base.replace(/ and /g, ' & '));
  if (base.includes(' & ')) aliases.push(base.replace(/ & /g, ' and '));
  const words = base.split(' ');
  const short = [...words];
  while (short.length > 1 && GENERIC_TAIL.has(short.at(-1).replace(/\.$/, ''))) short.pop();
  const shortName = short.join(' ');
  if (shortName !== base) {
    const single = short.length === 1;
    if (!single || (words.length <= 3 && shortName.length >= 5 && !SHORT_ALIAS_STOP.has(shortName))) aliases.push(shortName);
  }
  return [...new Set(aliases)].filter((a) => a.length >= 3);
}

/** A distinctive first word ("Suzlon" for Suzlon Energy), matched only when capitalised. */
function firstWordAlias(name) {
  const words = baseName(name).split(' ');
  const w = words[0].replace(/[^A-Za-z]/g, '');
  if (words.length < 2 || w.length < 5 || w !== words[0] || SHORT_ALIAS_STOP.has(w.toLowerCase())) return null;
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Install the stock universe used to recognise companies in news.
 * @param {{symbol: string, name: string, industry?: string}[]} stocks
 */
export function setStockUniverse(stocks) {
  const list = (stocks || []).filter((s) => s?.symbol);
  const bySymbol = new Map(list.map((s) => [s.symbol.toUpperCase(), s]));
  const owners = new Map(); // alias -> Set(symbol)
  for (const s of list) {
    if (!s.name) continue;
    for (const a of stockAliases(s.name)) {
      if (!owners.has(a)) owners.set(a, new Set());
      owners.get(a).add(s.symbol.toUpperCase());
    }
  }
  const aliasTo = new Map();
  for (const [a, syms] of owners) if (syms.size === 1) aliasTo.set(a, [...syms][0]);
  const firstOwners = new Map();
  for (const s of list) {
    const w = s.name && firstWordAlias(s.name);
    if (!w || owners.has(w.toLowerCase())) continue;
    if (!firstOwners.has(w)) firstOwners.set(w, new Set());
    firstOwners.get(w).add(s.symbol.toUpperCase());
  }
  const firstTo = new Map();
  for (const [w, syms] of firstOwners) if (syms.size === 1) { firstTo.set(w, [...syms][0]); firstTo.set(w.toUpperCase(), [...syms][0]); }
  for (const b of NAME_BLOCKERS) aliasTo.set(b, null);
  const alts = [...aliasTo.keys()].sort((x, y) => y.length - x.length).map(escapeRe);
  const syms = [...bySymbol.keys()].filter((k) => k.length >= 3 && !SYMBOL_STOP.has(k) && /[A-Z]/.test(k));
  universe = {
    list,
    bySymbol,
    aliasTo,
    firstTo,
    firstRe: firstTo.size ? new RegExp(`(?<![A-Za-z0-9&])(${[...firstTo.keys()].map(escapeRe).join('|')})(?![A-Za-z0-9&])`, 'g') : null,
    nameRe: alts.length ? new RegExp(`(?<![a-z0-9&])(${alts.join('|')})(?![a-z0-9&])`, 'gi') : null,
    symbolRe: syms.length ? new RegExp(`(?<![A-Za-z0-9&-])(${syms.sort((x, y) => y.length - x.length).map(escapeRe).join('|')})(?![A-Za-z0-9&-])`, 'g') : null,
  };
  return list.length;
}

export function stockUniverseSize() { return universe.list.length; }

function universeTv(symbol) {
  return `BSE:${symbol.replace(/[-&]/g, '_')}`;
}

/** Companies from the universe mentioned in the text, in order of appearance. */
function matchUniverse(text) {
  const hits = [];
  const add = (sym) => { if (sym && !hits.includes(sym)) hits.push(sym); };
  if (universe.nameRe) for (const m of text.matchAll(universe.nameRe)) add(universe.aliasTo.get(m[1].toLowerCase()));
  if (universe.firstRe) for (const m of text.matchAll(universe.firstRe)) add(universe.firstTo.get(m[1]));
  if (universe.symbolRe) for (const m of text.matchAll(universe.symbolRe)) add(m[1]);
  return hits.map((sym) => universe.bySymbol.get(sym)).filter(Boolean);
}

export function tradingViewSymbol(name) {
  if (instrumentByName[name]) return instrumentByName[name];
  if (name && universe.bySymbol.has(String(name).toUpperCase())) return universeTv(String(name).toUpperCase());
  return null;
}

function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=["'‘“(₹$A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 15)).replace(/[,;:\s]+$/, '') + '…';
}

// The sentence around a match, trimmed to whole words.
function numberContext(text, index, length, max = 110) {
  const before = text.slice(0, index);
  const boundaries = [...before.matchAll(/[.!?]\s+/g)];
  const start = boundaries.length ? boundaries.at(-1).index + boundaries.at(-1)[0].length : 0;
  const endRel = text.slice(index + length).search(/[.!?](\s|$)/);
  const end = endRel === -1 ? text.length : index + length + endRel;
  let ctx = text.slice(start, end).trim();
  if (ctx.length <= max) return ctx;
  const pos = index - start;
  let from = Math.max(0, pos - Math.floor(max / 2));
  let to = Math.min(ctx.length, from + max);
  from = Math.max(0, to - max);
  let piece = ctx.slice(from, to);
  if (from > 0) piece = `…${piece.replace(/^\S*\s/, '')}`;
  if (to < ctx.length) piece = `${piece.replace(/\s\S*$/, '')}…`;
  return piece.trim();
}

export function extractKeyNumbers(text) {
  const out = [];
  const seen = new Set();
  const patterns = [
    { re: /(?:₹|rs\.?|inr)\s?[\d,]+(?:\.\d+)?\s?(?:lakh crore|crore|cr|lakh|billion|bn|million|mn)?/gi, kind: 'amount' },
    { re: /(?:\$|usd|us\$)\s?[\d,]+(?:\.\d+)?\s?(?:trillion|billion|bn|million|mn|per barrel|\/bbl|an ounce|per ounce)?/gi, kind: 'amount' },
    { re: /[+-]?\d+(?:\.\d+)?\s?(?:%|per cent|percent)/gi, kind: 'pct' },
    { re: /\d+(?:\.\d+)?\s?(?:bps|basis points?)/gi, kind: 'bps' },
    { re: /[\d,]+(?:\.\d+)?\s?(?:points|pts)/gi, kind: 'points' },
  ];
  for (const { re, kind } of patterns) {
    for (const m of text.matchAll(re)) {
      const value = m[0].trim().replace(/\s+/g, ' ');
      const key = value.toLowerCase();
      if (seen.has(key) || /^[\d,.]+$/.test(value)) continue;
      seen.add(key);
      out.push({ value, kind, context: numberContext(text, m.index, m[0].length) });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

function maxPercent(text) {
  let max = 0;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?(?:%|per cent|percent)/gi)) {
    const v = parseFloat(m[1]);
    if (v < 100 && v > max) max = v;
  }
  return max;
}

function scoreSentiment(text) {
  let score = 0;
  const pos = [];
  const neg = [];
  const check = (words, sign, bucket) => {
    for (const w of words) {
      for (const m of text.matchAll(wordRe(w))) {
        const before = text.slice(Math.max(0, m.index - 14), m.index);
        const negated = NEGATORS.some((n) => before.includes(n));
        score += negated ? -sign : sign;
        bucket.push(w.trim());
      }
    }
  };
  check(BULLISH, 1, pos);
  check(BEARISH, -1, neg);
  // Policy-rate direction is the strongest macro signal; phrasing varies a lot.
  if (/\b(cut|cuts|reduc\w*|lower\w*)\s+(?:the\s+)?(?:policy\s+)?(?:repo\s+|interest\s+|key\s+)?rates?\b/.test(text)) { score += 2; pos.push('rate cut'); }
  if (/\b(hike\w*|rais\w*|increas\w*)\s+(?:the\s+)?(?:policy\s+)?(?:repo\s+|interest\s+|key\s+)?rates?\b/.test(text)) { score -= 2; neg.push('rate hike'); }
  return { score, pos, neg };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Analyse a news item.
 * @param {{title: string, description?: string, source?: string, category?: string}} item
 *   `category` is the feed's default asset class and is used as a prior.
 */
export function analyzeArticle(item) {
  const title = cleanText(item.title);
  const body = cleanText(item.description || '');
  const full = `${title}. ${body}`;
  const text = ` ${full.toLowerCase()} `;
  const titleLc = ` ${title.toLowerCase()} `;

  // Asset class: keyword scores plus a prior from the feed category.
  const assetScores = { Equities: 0.5, Commodities: 0, Macro: 0, Geopolitics: 0 };
  for (const cls of Object.keys(ASSET_KEYWORDS)) {
    assetScores[cls] += countHits(text, ASSET_KEYWORDS[cls]).n;
    assetScores[cls] += countHits(titleLc, ASSET_KEYWORDS[cls]).n; // title counts double
  }
  if (item.category && assetScores[item.category] !== undefined) assetScores[item.category] += 1.5;

  // Sub-sector
  let best = null;
  for (const s of SUBSECTORS) {
    const score = countHits(text, s.kw).n + countHits(titleLc, s.kw).n;
    if (score > 0 && (!best || score > best.score)) best = { ...s, score };
  }
  if (best) assetScores[best.asset] += 1;
  const assetClass = Object.entries(assetScores).sort((a, b) => b[1] - a[1])[0][0];

  let subSector = best?.name;
  if (!subSector || (best.asset !== assetClass && best.score < 2)) {
    subSector = { Equities: 'Markets', Commodities: 'Energy', Macro: 'Central Bank', Geopolitics: 'Conflict & Security' }[assetClass];
    if (assetClass === 'Commodities' && /gold|silver|bullion/.test(text)) subSector = 'Precious Metals';
    if (assetClass === 'Commodities' && /copper|steel|alumin|zinc|nickel/.test(text)) subSector = 'Metals';
    if (assetClass === 'Geopolitics' && /tariff|trade|sanction|embargo/.test(text)) subSector = 'Trade & Tariffs';
    if (assetClass === 'Macro' && /inflation|gdp|cpi|iip|pmi/.test(text)) subSector = 'Inflation & Growth';
  }

  // Sentiment
  const sent = scoreSentiment(text);
  const titleSent = scoreSentiment(titleLc).score;
  const sScore = sent.score + titleSent; // headline weighs double
  const sentiment = sScore >= 1 ? 'Bullish' : sScore <= -1 ? 'Bearish' : 'Neutral';

  // Impact
  const high = countHits(text, HIGH_IMPACT);
  const med = countHits(text, MEDIUM_IMPACT);
  const pct = maxPercent(full);
  let impactScore = high.n * 2 + med.n * 0.6 + countHits(titleLc, HIGH_IMPACT).n * 1.5;
  if (pct >= 5) impactScore += 3;
  else if (pct >= 2) impactScore += 1;
  if (assetClass === 'Macro' && subSector === 'Central Bank' && /repo|policy rate|monetary policy/.test(text)) impactScore += 3;
  if (assetClass === 'Geopolitics') impactScore += 1;
  if (/^\s*(press release|circular|notification)\b/i.test(title)) impactScore -= 1;
  const impact = impactScore >= 4.5 ? 'High' : impactScore >= 1.8 ? 'Medium' : 'Low';

  // Instruments
  const found = [];
  for (const m of instrumentMatchers) {
    if (m.re.test(full) && !found.includes(m.name)) found.push(m.name);
  }
  const foundTv = new Set(found.map((n) => instrumentByName[n]));
  const companies = matchUniverse(full);
  for (const c of companies) {
    const sym = c.symbol.toUpperCase();
    if (found.includes(sym) || foundTv.has(universeTv(sym))) continue;
    found.push(sym);
  }
  // Use the first named company's NSE industry when the keywords gave no clear sector.
  if (assetClass === 'Equities' && companies.length && (!best || best.score < 2 || ['Markets', 'Corporate Action'].includes(subSector))) {
    const c = companies[0];
    const ind = INDUSTRY_SUBSECTOR[String(c.industry || '').toLowerCase()];
    if (ind) subSector = ind === 'NBFC & Financials' && /\bbank\b/i.test(c.name) ? 'Banking' : ind;
  }
  // "gold"/"silver" etc. mentioned only incidentally in equities stories are noise.
  const instruments = found.slice(0, 6);
  const focus = instruments.length ? instruments : (SECTOR_PROXIES[subSector] || ['NIFTY 50']);

  const keyNumbers = extractKeyNumbers(full);

  // --- Three-bullet executive summary ---
  const bodySentences = sentences(body).filter((s) => s.toLowerCase() !== title.toLowerCase());
  let what = title;
  // Descriptive headlines already say what happened; terse ones (exchange filings) don't.
  if (title.length < 55 && bodySentences.length && bodySentences[0].length > 40) what = bodySentences[0];
  what = truncate(what.replace(/[.\s]+$/, ''), 220);

  const direction = {
    Bullish: 'positive', Bearish: 'negative', Neutral: 'mixed-to-neutral',
  }[sentiment];
  const weight = { High: 'a material', Medium: 'a moderate', Low: 'a limited' }[impact];
  const numHint = keyNumbers.find((k) => k.kind !== 'points');
  const impactTarget = {
    Equities: `${subSector === 'Markets' || subSector === 'Corporate Action' ? 'the stocks named' : `${subSector} stocks`}`,
    Commodities: `${subSector.toLowerCase()} prices and linked equities`,
    Macro: 'rate-sensitive sectors, bond yields and the rupee',
    Geopolitics: subSector === 'Trade & Tariffs'
      ? 'exporters, the rupee and the targeted sectors'
      : 'risk appetite, crude and safe-haven assets',
  }[assetClass];
  let impactLine = `${weight[0].toUpperCase()}${weight.slice(1)}, ${direction} read-through for ${impactTarget}`;
  if (numHint) impactLine += ` (key figure: ${numHint.value})`;
  if (impact === 'High') impactLine += '; expect elevated volatility';
  const reasons = (sentiment === 'Bearish' ? sent.neg : sentiment === 'Bullish' ? sent.pos : []).slice(0, 2);
  if (reasons.length) impactLine += ` — signals: ${[...new Set(reasons)].join(', ')}`;

  const focusLine = `${instruments.length ? 'In focus' : 'Watch (sector proxies)'}: ${focus.join(', ')}`;

  return {
    assetClass,
    subSector,
    impact,
    sentiment,
    summary: [what, impactLine, focusLine],
    instruments: focus,
    tvSymbol: tradingViewSymbol(focus[0]) || 'NSE:NIFTY',
    keyNumbers,
    scores: { impact: Math.round(impactScore * 10) / 10, sentiment: sScore },
    engine: 'rules',
  };
}
