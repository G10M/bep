require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const rateLimit = require('express-rate-limit');
const basicAuth = require('express-basic-auth');
const fs = require('fs');

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
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Логируем все консольные ошибки со страницы
    page.on('console', msg => console.log('БРАУЗЕР:', msg.text()));
    page.on('pageerror', err => console.log('ОШИБКА JS НА САЙТЕ:', err.message));
    
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('Открываем страницу логина...');
    await page.goto('https://app.rubep.com/', {
      waitUntil: 'networkidle2',
      timeout: 60_000
    });

    // ПРОВЕРКА НА CLOUDFLARE
    const pageTitle = await page.title();
    console.log('Заголовок страницы:', pageTitle);
    if (pageTitle.includes('Just a moment') || pageTitle.includes('Cloudflare')) {
      console.log('ВНИМАНИЕ: Мы уперлись в Cloudflare!');
      throw new Error('Cloudflare блокирует вход (капча)');
    }

    console.log('Вводим логин и пароль...');
    await page.waitForSelector('input[type="email"]', { timeout: 30_000 });
    await page.type('input[type="email"]', process.env.RUBEP_LOGIN);
    await page.type('input[type="password"]', process.env.RUBEP_PASSWORD);

    const responsePromise = page.waitForResponse(async response => {
      if (response.url().includes('/api/') && response.request().method() === 'GET') {
        try {
          const json = await response.json();
          if (json && json.success && json.data && json.data.cards) {
            return true;
          }
        } catch (e) { return false; }
      }
      return false;
    }, { timeout: 30_000 });

    console.log('Нажимаем кнопку "Войти"...');
    await page.click('button[type="submit"]');

    const response = await responsePromise;
    const json = await response.json();
    const balance = json.data.cards[0].balance;
    
    console.log(`Успех! Баланс: ${balance}`);
    return balance;

  } catch (err) {
    console.error('!!! ПРОИЗОШЛА ОШИБКА !!!');
    console.error('Текст ошибки:', err.message);
    
    // Если ошибка - делаем скриншот и сохраняем HTML
    const page = (await browser.pages())[0];
    if (page) {
      await page.screenshot({ path: 'error-screenshot.png' });
      const html = await page.content();
      console.log('--- НАЧАЛО HTML КОДА СТРАНИЦЫ (ищем Cloudflare) ---');
      console.log(html.substring(0, 1000)); // Выводим первые 1000 символов
      console.log('--- КОНЕЦ HTML КОДА ---');
    }
    throw err;
  } finally {
    await browser.close();
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
    res.status(502).json({ error: 'Не удалось получить баланс' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
