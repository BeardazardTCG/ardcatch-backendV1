const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('CardCatch v2 backend is running.');
});

app.post('/api/fetchCardPrices', async (req, res) => {
  try {
    const {
      cardName,
      setName,
      rarityKeyword,
      mustInclude,
      mustNotInclude,
      graded,
      gradingCompany,
      grade
    } = req.body;

    const keywords = [cardName, setName, rarityKeyword].filter(Boolean).join(' ');
    const includeKeywords = mustInclude ? mustInclude.split(',').map(w => w.trim()) : [];
    const excludeKeywords = mustNotInclude ? mustNotInclude.split(',').map(w => w.trim()) : [];

    const ebayResponse = await axios.post('https://api.scraperapi.com/', {
      apiKey: 'YOUR_SCRAPERAPI_KEY',  // Insert your ScraperAPI key if needed
      url: `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(keywords)}&_sop=13&LH_Sold=1&LH_Complete=1&LH_BIN=1&LH_ItemCondition=3000&LH_LocatedIn=GB&rt=nc&LH_PrefLoc=1&_ipg=200`
    });

    const html = ebayResponse.data;
    const itemRegex = /"itemTitle":"(.*?)".*?"price":"([\d\.]+)"/g;
    let match;
    const items = [];

    while ((match = itemRegex.exec(html)) !== null) {
      const title = match[1];
      const price = parseFloat(match[2]);

      if (includeKeywords.length && !includeKeywords.some(word => title.toLowerCase().includes(word.toLowerCase()))) {
        continue;
      }
      if (excludeKeywords.length && excludeKeywords.some(word => title.toLowerCase().includes(word.toLowerCase()))) {
        continue;
      }
      if (graded && gradingCompany) {
        if (!title.toLowerCase().includes(gradingCompany.toLowerCase())) continue;
      }
      if (graded && grade) {
        if (!title.includes(grade)) continue;
      }

      items.push(price);
    }

    if (items.length === 0) {
      return res.json({
        avgPrice: 0,
        soldCount: 0,
        priceMin: 0,
        priceMax: 0
      });
    }

    const avgPrice = items.reduce((a, b) => a + b, 0) / items.length;
    const priceMin = Math.min(...items);
    const priceMax = Math.max(...items);

    res.json({
      avgPrice: parseFloat(avgPrice.toFixed(2)),
      soldCount: items.length,
      priceMin: priceMin,
      priceMax: priceMax
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
