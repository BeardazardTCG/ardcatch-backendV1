const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600 });
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

async function getToken() {
  const tokenRes = await axios.post(
    'https://api.ebay.com/identity/v1/oauth2/token',
    'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    {
      auth: {
        username: process.env.EBAY_CLIENT_ID,
        password: process.env.EBAY_CLIENT_SECRET
      },
      headers: { 'Content-Type':'application/x-www-form-urlencoded' }
    }
  );
  return tokenRes.data.access_token;
}

async function doSearch(query) {
  const token = await getToken();
  const params = new URLSearchParams({ q: query, limit:'5' });
  const res = await axios.get(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    { headers:{ Authorization:`Bearer ${token}` } }
  );
  const items = res.data.itemSummaries||[];
  const prices = items.map(i=>parseFloat(i.price.value));
  const count = prices.length;
  const avgPrice = count ? prices.reduce((a,b)=>a+b,0)/count : 0;
  return { items, count, avgPrice };
}

async function fetchOne({ cardName, setName, cardNumber, condition, sellerLocation }) {
  const base = [cardName, setName, cardNumber].filter(Boolean).join(' ');
  // Primary: base + sold + filters
  const primary = [base, 'sold', `location:${sellerLocation}`]
    .concat(condition?[`condition:${condition}`]:[])
    .join(' ');
  const key = primary.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  // 1️⃣ Try primary
  let result = await doSearch(primary);

  // 2️⃣ Fallback: drop only the condition filter (keep sold+location)
  if (result.count===0 && condition) {
    const fallback = [base, 'sold', `location:${sellerLocation}`].join(' ');
    result = await doSearch(fallback);
  }

  cache.set(key, result);
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

app.listen(port, ()=>console.log(`Server live on ${port}`));
