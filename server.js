const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const { parseStringPromise } = require('xml2js');

const cache = new NodeCache({ stdTTL: 3600 });
const app = express();
const port = process.env.PORT || 3000;
const FINDING_BASE = 'https://svcs.ebay.com/services/search/FindingService/v1';

async function getBrowseToken() {
  const r = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    {
      auth: { username: process.env.EBAY_CLIENT_ID, password: process.env.EBAY_CLIENT_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
  return r.data.access_token;
}

function summarize(prices) {
  const n = prices.length;
  if (n === 0) return { count: 0, avgPrice: 0, median: 0, min: 0, max: 0, stdDev: 0 };
  prices.sort((a,b)=>a-b);
  const sum = prices.reduce((a,b)=>a+b, 0);
  const avg = sum / n;
  const mid = Math.floor(n/2);
  const median = n % 2 === 1
    ? prices[mid]
    : (prices[mid-1] + prices[mid]) / 2;
  const min = prices[0];
  const max = prices[n-1];
  const variance = prices.reduce((v, p) => v + Math.pow(p - avg, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  return { count: n, avgPrice: avg, median, min, max, stdDev };
}

async function browseSearch(query) {
  const token = await getBrowseToken();
  const params = new URLSearchParams({ q: query, limit: '5' });
  const r = await axios.get(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const prices = (r.data.itemSummaries || []).map(i => parseFloat(i.price.value));
  return summarize(prices);
}

async function findingSearch(keywords, daysAgo) {
  const now = new Date();
  const from = new Date(now - daysAgo*24*3600*1000).toISOString();
  const to   = now.toISOString();
  const xml = await axios.get(FINDING_BASE, {
    params: {
      'OPERATION-NAME':'findCompletedItems',
      'SERVICE-VERSION':'1.13.0',
      'SECURITY-APPNAME':process.env.EBAY_CLIENT_ID,
      'RESPONSE-DATA-FORMAT':'XML',
      'REST-PAYLOAD':true,
      keywords,
      'itemFilter(0).name':'SoldItemsOnly',
      'itemFilter(0).value':'true',
      'itemFilter(1).name':'EndTimeFrom',
      'itemFilter(1).value':from,
      'itemFilter(2).name':'EndTimeTo',
      'itemFilter(2).value':to,
      'paginationInput.entriesPerPage':'100'
    }
  }).then(r=>r.data);
  const js = await parseStringPromise(xml);
  const prices = (js.findCompletedItemsResponse.searchResult[0].item || [])
    .map(i => parseFloat(i.sellingStatus[0].currentPrice[0]._));
  return summarize(prices);
}

async function fetchOne(opts) {
  const { cardName, setName, cardNumber, condition, sellerLocation, globalFallback, daysAgo } = opts;
  const base = [cardName, setName, cardNumber].filter(Boolean).join(' ');
  // 1) daysAgo via Finding API
  if (daysAgo > 0) {
    try { return await findingSearch(base, daysAgo); }
    catch(err) { console.warn('Finding error, fallback…'); }
  }
  // 2) Browse logic
  const primary = [base, 'sold', `location:${sellerLocation}`]
    .concat(condition? [`condition:${condition}`]:[])
    .join(' ');
  const key = primary.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let result = await browseSearch(primary);
  if (result.count===0 && condition) {
    const f2 = [base, 'sold', `location:${sellerLocation}`].join(' ');
    result = await browseSearch(f2);
  }
  if (result.count===0 && globalFallback) {
    result = await browseSearch([base,'sold'].join(' '));
  }
  cache.set(key, result);
  return result;
}

app.use(express.json());
app.post('/api/fetchBulkPrices', async (req, res) => {
  try {
    const inputs = req.body;
    if (!Array.isArray(inputs)) return res.status(400).json({ error:'Expected an array' });
    const out = await Promise.all(inputs.map(fetchOne));
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:'Bulk fetch failed', details:e.toString() });
  }
});

app.listen(port,()=>console.log(`Server on port ${port}`));
