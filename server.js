const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600 });
const app = express();
const port = process.env.PORT || 3000;

// noise terms to exclude from titles
const NOISE_REGEX = /\b(lot|binder|bulk|proxy)\b/i;
// outlier price bounds
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

async function browseSearch({ cardName, setName, condition, rarity, graded, language }) {
  const token = await getToken();
  const parts = ['sold', cardName, setName];
  if (condition) parts.push(condition);
  if (rarity)    parts.push(rarity);
  if (language)  parts.push(language);
  // we'll filter for graded IDs in code, not in query
  const query = parts.join(' ');
  const params = new URLSearchParams({ q: query, limit: '10' });
  const resp = await axios.get(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const items = resp.data.itemSummaries || [];

  // 1) text‐filter
  let filtered = items.filter(i => {
    const t = i.title.toLowerCase();
    if (NOISE_REGEX.test(t))            return false;
    if (condition && !t.includes(condition.toLowerCase())) return false;
    if (rarity    && !t.includes(rarity.toLowerCase()))    return false;
    if (language  && !t.includes(language.toLowerCase()))  return false;
    if (graded) {
      // only PSA/CGC listings
      if (!/(psa|cgc)/i.test(t)) return false;
    } else {
      // exclude any PSA/CGC
      if (/(psa|cgc)/i.test(t))  return false;
    }
    return true;
  });

  // 2) numeric filter
  const prices = filtered
    .map(i => parseFloat(i.price.value))
    .filter(p => p >= MIN_PRICE && p <= MAX_PRICE);

  const count = prices.length;
  const avgPrice = count
    ? prices.reduce((sum, v) => sum + v, 0) / count
    : 0;

  return { avgPrice, count };
}

async function fetchOne(opts) {
  const key = JSON.stringify(opts).toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const result = await browseSearch(opts);
  cache.set(key, result);
  return result;
}

app.use(express.json());
app.post('/api/fetchBulkPrices', async (req, res) => {
  try {
    const rows = req.body;
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected an array of inputs' });
    }
    const out = await Promise.all(
      rows.map(r => fetchOne(r))
    );
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Bulk fetch failed', details: e.toString() });
  }
});

app.listen(port, () => {
  console.log(`CardCatch backend running on port ${port}`);
});
