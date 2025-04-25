const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600 });
const app = express();
const port = process.env.PORT || 3000;

// noise terms to exclude
const NOISE_REGEX = /\b(lot|binder|bulk|psa|proxy)\b/i;
// acceptable price range
const MIN_PRICE = 2;
const MAX_PRICE = 500;

async function getToken() {
  const r = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    {
      auth: {
        username: process.env.EBAY_CLIENT_ID,
        password: process.env.EBAY_CLIENT_SECRET
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
  return r.data.access_token;
}

async function browseSearch(cardName, setName, cardNumber, condition, sellerLocation) {
  const token = await getToken();
  const queryParts = ['sold', `location:${sellerLocation}`, cardName, setName];
  if (condition) queryParts.push(`condition:${condition}`);
  const query = queryParts.join(' ');
  const params = new URLSearchParams({ q: query, limit: '10' });
  const r = await axios.get(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const items = r.data.itemSummaries || [];
  
  // 1) strict filter: must contain cardNumber
  let filtered = items.filter(i => {
    const t = i.title.toLowerCase();
    return t.includes(cardNumber.toLowerCase());
  });
  
  // 2) if none, fallback: drop cardNumber requirement
  if (filtered.length === 0) {
    filtered = items;
  }
  
  // final filtering: noise, exact name & set, condition, price range
  const clean = filtered.filter(i => {
    const t = i.title.toLowerCase();
    if (NOISE_REGEX.test(t)) return false;
    if (!t.includes(cardName.toLowerCase())) return false;
    if (!t.includes(setName.toLowerCase())) return false;
    if (condition.toLowerCase() === 'new' && !/near mint|mint/i.test(t)) return false;
    if (condition.toLowerCase() === 'used' && /sealed|new/i.test(t)) return false;
    const p = parseFloat(i.price.value);
    return p >= MIN_PRICE && p <= MAX_PRICE;
  });
  
  const prices = clean.map(i => parseFloat(i.price.value));
  const count = prices.length;
  const avgPrice = count ? prices.reduce((s,p) => s + p, 0) / count : 0;
  return { avgPrice, count };
}

async function fetchOne(opts) {
  const { cardName, setName, cardNumber, condition = '', sellerLocation = '', globalFallback = false } = opts;
  const cacheKey = [cardName, setName, cardNumber, condition, sellerLocation].join('|').toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // 1) browse search with fallback built in
  let result = await browseSearch(cardName, setName, cardNumber, condition, sellerLocation);

  // 2) optional global fallback if still zero
  if (result.count === 0 && globalFallback) {
    result = await browseSearch(cardName, setName, cardNumber, condition, '');
  }

  cache.set(cacheKey, result);
  return result;
}

app.use(express.json());
app.post('/api/fetchBulkPrices', async (req, res) => {
  try {
    const inputs = req.body;
    if (!Array.isArray(inputs)) {
      return res.status(400).json({ error: 'Expected an array of inputs' });
    }
    const out = await Promise.all(inputs.map(fetchOne));
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Bulk fetch failed', details: e.toString() });
  }
});

app.listen(port, () => {
  console.log(`CardCatch backend running on port ${port}`);
});

});

app.listen(port, () => {
  console.log(`CardCatch backend running on port ${port}`);
});
