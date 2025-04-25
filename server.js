// server.js
const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('CardCatch backend is live!');
});

app.get('/api/fetchCardPrice', async (req, res) => {
  try {
    const { cardName, setName, cardNumber } = req.query;
    if (!cardName) {
      return res.status(400).json({ error: 'cardName query parameter is required' });
    }

    const tokenResponse = await axios.post(
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
    const accessToken = tokenResponse.data.access_token;

    const searchQuery = [cardName, setName, cardNumber, 'sold']
      .filter(Boolean)
      .join(' ');
    const params = new URLSearchParams({ q: searchQuery, limit: '5' });

    const itemsResponse = await axios.get(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const items = itemsResponse.data.itemSummaries || [];

    const prices = items.map(item => parseFloat(item.price.value));
    const avgPrice = prices.length > 0
      ? prices.reduce((sum, p) => sum + p, 0) / prices.length
      : 0;

    res.json({ avgPrice, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to fetch from eBay',
      details: err.toString()
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

