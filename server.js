const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600 });
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

async function doSearch(searchQuery) {
  const params = new URLSearchParams({ q: searchQuery, limit: '5' });
  const itemsRes = await axios.get(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    { headers: { Authorization: `Bearer ${await getToken()}` } }
  );
  const items = itemsRes.data.itemSummaries || [];
  const prices = items.map(i => parseFloat(i.price.value));
  return { items, count: prices.length, avgPrice: prices.length ? prices.reduce((a,b)=>a+b,0)/prices.length : 0 };
}

async function getToken() {
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
  return tokenRes.data.access_token;
}

async function fetchOne({ cardName, setName, cardNumber, condition, sellerLocation }) {
  const baseParts = [cardName, setName, cardNumber, 'sold'].filter(Boolean);
  const filters = [...baseParts];
  if (condition) filters.push(`condition:${condition}`);
  if (sellerLocation) filters.push(`location:${sellerLocation}`);
  const primaryQuery = filters.join(' ');
  const cacheKey = primaryQuery.toLowerCase();

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // 1) Primary search
  let result = await doSearch(primaryQuery);

  // 2) Fallback if no results
  if (result.count === 0) {
    const fallbackQuery = baseParts.join(' ');
    result = await doSearch(fallbackQuery);
  }

  cache.set(cacheKey, result);
  return result;
}

app.post('/api/fetchBulkPrices', async (req, res) => {
  try {
    const inputs = req.body;
    if (!Array.isArray(inputs)) {
      return res.status(400).json({ error: 'Expected an array of inputs' });
    }
    const results = await Promise.all(inputs.map(i => fetchOne(i)));
    res.json(results);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Bulk fetch failed', details: e.toString() });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
