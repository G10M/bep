require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const basicAuth = require('express-basic-auth');

const app = express();
app.set('trust proxy', 1);

// Защита для твоего друга (пароль 12345@R)
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

// Токен храним в памяти сервера
let currentToken = null; 

async function loginToRubep() {
  console.log('🔐 Логинимся в RUBep по паролю...');
  
  // ВАЖНО: Если сайт выдаст ошибку 404, значит адрес для входа другой.
  // Мы это увидим в логах.
  const response = await fetch('https://app.rubep.com/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://app.rubep.com',
      'Referer': 'https://app.rubep.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      email: process.env.RUBEP_LOGIN,
      password: process.env.RUBEP_PASSWORD
    })
  });

  if (!response.ok) {
    const text = await response.text();
    console.log('❌ Ошибка входа:', response.status, text.substring(0, 300));
    throw new Error(`Не удалось залогиниться. Статус: ${response.status}`);
  }

  const json = await response.json();
  if (json.success && json.data && json.data.accessToken) {
    console.log('✅ Успешный вход! Токен получен.');
    return json.data.accessToken;
  }
  throw new Error('Не удалось найти accessToken в ответе входа');
}

async function fetchBalanceFromRubep() {
  const apiUrl = 'https://app.rubep.com/api/v1/cards';
  
  if (!currentToken) {
    currentToken = await loginToRubep();
  }

  const makeRequest = async (token) => {
    return await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
  };

  console.log('Делаем запрос к API карт...');
  let response = await makeRequest(currentToken);

  // Если токен протух, логинимся заново
  if (response.status === 401) {
    console.log('🔄 Токен протух, логинимся заново...');
    currentToken = await loginToRubep();
    response = await makeRequest(currentToken);
  }

  if (!response.ok) {
    const text = await response.text();
    console.log('❌ Ошибка API:', response.status, text.substring(0, 300));
    throw new Error(`Ошибка API: ${response.status}`);
  }

  const json = await response.json();
  
  if (json && json.success && json.data && Array.isArray(json.data.cards) && json.data.cards.length > 0) {
    const balance = json.data.cards[0].balance;
    console.log(`✅ Успех! Баланс: ${balance}`);
    return balance;
  } else {
    throw new Error('Не удалось найти баланс в ответе');
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
