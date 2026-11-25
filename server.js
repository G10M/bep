require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const basicAuth = require('express-basic-auth');

const app = express();
app.set('trust proxy', 1);

app.use(basicAuth({
    users: { [process.env.APP_USER || 'friend']: process.env.APP_PASS || '12345@R' },
    challenge: true,
    realm: 'Rubep Balance'
}));

app.use(express.static('public'));
const limiter = rateLimit({ windowMs: 60_000, max: 5 });
app.use('/api/', limiter);

let cache = { value: null, ts: 0 };
const CACHE_TTL = 60_000; 

async function fetchBalanceFromRubep() {
  console.log('Делаем прямой запрос к API RUBep...');
  
  // Сюда мы вставим куки, которые ты прислал
  const cookieString = process.env.RUBEP_COOKIES;

  if (!cookieString) {
    throw new Error('Не заданы куки RUBEP_COOKIES в настройках Render!');
  }

  // ВАЖНО: Проверь точный URL запроса во вкладке Network (он начинается с https://app.rubep.com/api/...)
  // Я использую предполагаемый путь, если он не сработает, мы его поправим.
  const apiUrl = 'https://app.rubep.com/api/cards'; 

  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Cookie': cookieString,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    console.log('Статус ответа:', response.status);
    console.log('Тело ответа:', text.substring(0, 200));
    throw new Error(`Ошибка API: ${response.status}`);
  }

  const json = await response.json();
  
  if (json && json.success && json.data && json.data.cards && json.data.cards.length > 0) {
    const balance = json.data.cards[0].balance;
    console.log(`Успех! Баланс: ${balance}`);
    return balance;
  } else {
    throw new Error('Не удалось найти баланс в JSON');
  }
}

app.get('/api/balance', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.value && now - cache.ts < CACHE_TTL) {
      return res.json({ balance: cache.value, cached: true });
    }
    const balance = await fetchBalanceFromRubep();
    cache = { value: balance, ts: now };
    res.json({ balance, cached: false });
  } catch (err) {
    console.error('Ошибка получения баланса:', err.message);
    res.status(502).json({ error: 'Не удалось получить баланс' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
