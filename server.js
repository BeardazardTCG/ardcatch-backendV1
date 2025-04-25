const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

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
      mustInclude,
      mustNotInclude,
      graded,
      gradingCompany,
      grade
    } = req.body;

    const keywords = [cardName, setName].filter(Boolean).join(' ');

    const includeKeywords = mustInclude ? mustInclude.split(',').map(w => w.trim().toLowerCase()) : [];
    const excludeKeywords = mustNotInclude ? mustNotInclude.split(',').map(w => w.trim().toLowerCase()) : [];

    const ebayUrl = `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(keywords)}&_sop=13&LH_Sold=1&LH_Complete=1&LH_BIN=1&LH_LocatedIn=GB&_ipg=200`;

    const ebayResponse = await axios.get('https://api.scraperapi.com/', {
      params: {
        apiKey: 'YOUR_SCRAPERAPI_KEY',  // <-- Insert your ScraperAPI Key
        url: ebayUrl
      }
    });

    const html = ebayResponse.data;
    const $ = cheerio.load(html);
    const items = [];

    $('li.s-item').each((index, element) => {
      const title = $(element).find('.s-item__title').text().trim();
      let priceText = $(element).find('.s-item__price').first().text().trim();

      if (!title || !priceText) return;

      priceText = priceText.replace(/[^\d\.]/g, '');
      const price = parseFloat(priceText);

      if (isNaN(price)) return;

      const titleLower = title.toLowerCase();

      if (graded && gradingCompany && !titleLower.includes(gradingCompany.toLowerCase())) return;
      if (graded && grade && !title.includes(grade)) return;

      if (includeKeywords.length && !includeKeywords.some(word => titleLower.includes(word))) return;
      if (excludeKeywords.length && excludeKeywords.some(word => titleLower.includes(word))) return;

      items.push(price);
    });

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

    return res.json({
      avgPrice: parseFloat(avgPrice.toFixed(2)),
      soldCount: items.length,
      priceMin: parseFloat(priceMin.toFixed(2)),
      priceMax: parseFloat(priceMax.toFixed(2))
    });

  } catch (error) {
    console.error(error.message);
    return res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
