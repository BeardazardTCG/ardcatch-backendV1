const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600 });
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

async function getToken() {
  const res = await axios.post(
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
  return res.data.access_token;
}

async function doSearch(query) {
  const token = await getToken();
  const params = new URLSearchParams({ q: query, limit: '5' });
  const itemsRes = await axios.get(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const items = itemsRes.data.itemSummaries || [];
  const prices = items.map(i => parseFloat(i.price.value));
  const count = prices.length;
  const avgPrice = count ? prices.reduce((a,b)=>a+b,0)/count : 0;
  return { items, count, avgPrice };
}

async function fetchOne({ cardName, setName, cardNumber, condition, sellerLocation, globalFallback }) {
  const base = [cardName, setName, cardNumber].filter(Boolean).join(' ');
  // primary = base + sold + location + condition
  const primaryParts = [base, 'sold', `location:${sellerLocation}`];
  if (condition) primaryParts.push(`condition:${condition}`);
  const primaryQuery = primaryParts.join(' ');
  const cacheKey = primaryQuery.toLowerCase();
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // 1) strict UK search
  let result = await doSearch(primaryQuery);

  // 2) fallback: drop only condition
  if (result.count === 0 && condition) {
    const fallbackUK = [base, 'sold', `location:${sellerLocation}`].join(' ');
    result = await doSearch(fallbackUK);
  }

  // 3) optional global fallback
  if (result.count === 0 && globalFallback) {
    const globalQuery = [base, 'sold'].join(' ');
    result = await doSearch(globalQuery);
  }

  cache.set(cacheKey, result);
  return result;
}

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

app.listen(port, ()=>console.log(`Server running on port ${port}`));
