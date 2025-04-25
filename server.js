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

async function browseSearch(query, cardName, setName, cardNumber, condition) {
  const token = await getToken();
  const params = new URLSearchParams({ q: query, limit: '10' });
  const r = await axios.get(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  // strict filtering by title and noise/outliers
  const filtered = (r.data.itemSummaries || []).filter(item => {
    const title = item.title.toLowerCase();
    // must include exact card number, name, and set
    if (!title.includes(cardNumber.toLowerCase())) return false;
    if (!title.includes(cardName.toLowerCase())) return false;
    if (!title.includes(setName.toLowerCase())) return false;
    // exclude noise terms
    if (NOISE_REGEX.test(title)) return false;
    // condition filter if requested
    if (condition.toLowerCase() === 'new' && !/near mint|mint/i.test(title)) return false;
    if (condition.toLowerCase() === 'used' && /sealed|new/i.test(title)) return false;
    return true;
  });

  const prices = filtered
    .map(i => parseFloat(i.price.value))
    .filter(p => p >= MIN_PRICE && p <= MAX_PRICE);

  const count = prices.length;
  const avgPrice = count
    ? prices.reduce((sum, p) => sum + p, 0) / count
    : 0;

  return { avgPrice, count };
}

async function fetchOne({ cardName, setName, cardNumber, condition = '', sellerLocation = '', globalFallback = false }) {
  const base = [cardName, setName, cardNumber].filter(Boolean).join(' ');
  // Primary query: exact match + sold + location
  const primaryQueryParts = [base, 'sold'];
  if (sellerLocation) primaryQueryParts.push(`location:${sellerLocation}`);
  if (condition)      primaryQueryParts.push(`condition:${condition}`);
  const primaryQuery = primaryQueryParts.join(' ');
  const cacheKey = primaryQuery.toLowerCase();

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  // 1) try strict browse search
  let result = await browseSearch(primaryQuery, cardName, setName, cardNumber, condition);

  // 2) fallback: drop only condition filter
  if (result.count === 0 && condition) {
    const fallbackQuery = [base, 'sold', `location:${sellerLocation}`].join(' ');
    result = await browseSearch(fallbackQuery, cardName, setName, cardNumber, '');
  }

  // 3) optional global fallback: drop location
  if (result.count === 0 && globalFallback) {
    const globalQuery = [base, 'sold'].join(' ');
    result = await browseSearch(globalQuery, cardName, setName, cardNumber, '');
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
    const results = await Promise.all(inputs.map(fetchOne));
    res.json(results);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Bulk fetch failed', details: e.toString() });
  }
});

app.listen(port, () => {
  console.log(`CardCatch backend running on port ${port}`);
});
