const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600 });
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('CardCatch backend is live!');
});

async function fetchOne({ cardName, setName, cardNumber, condition, sellerLocation }) {
  const parts = [cardName, setName, cardNumber, 'sold'];
  if (condition) parts.push(`condition:${condition}`);
  if (sellerLocation) parts.push(`location:${sellerLocation}`);
  const searchQuery = parts.filter(Boolean).join(' ');
  const cacheKey = searchQuery.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // get token
  const tokenRes = await axios.post(
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
  const token = tokenRes.data.access_token;

  // search
  const params = new URLSearchParams({ q: searchQuery, limit: '5' });
  const itemsRes = await axios.get(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const items = itemsRes.data.itemSummaries || [];
  const prices = items.map(i => parseFloat(i.price.value));
  const avgPrice = prices.length ? prices.reduce((a,b)=>a+b,0)/prices.length : 0;
  const payload = { avgPrice, items };

  cache.set(cacheKey, payload);
  return payload;
}

app.post('/api/fetchBulkPrices', async (req, res) => {
  try {
    const inputs = req.body; // expect [{cardName, setName, cardNumber, condition?, sellerLocation?}, ...]
    if (!Array.isArray(inputs)) {
      return res.status(400).json({ error: 'Expected an array of inputs' });
    }
    const results = await Promise.all(
      inputs.map(i => fetchOne(i))
    );
    res.json(results);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Bulk fetch failed', details: e.toString() });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
