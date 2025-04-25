const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('CardCatch backend is live!');
});

// Test endpoint for card price fetch
app.get('/api/fetchCardPrice', (req, res) => {
  res.json({ message: 'fetchCardPrice endpoint is working' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
