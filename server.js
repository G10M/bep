require('dotenv').config();
const express = require('express');
const chromium = require('@sparticuz/chromium');
const rateLimit = require('express-rate-limit');
const basicAuth = require('express-basic-auth');

// Подключаем Стелс-режим
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.set('trust proxy', 1);

app.use(basicAuth({
    users: { [process.env.APP_USER || 'friend']: process.env.APP_PASS || '12345@R' },
    challenge: true,
    realm: 'Rubep Balance'
}));

app.use(express.static('public')); // Отсюда мы потом скачаем скриншот
const limiter = rateLimit({ windowMs: 60_000, max: 5 });
app.use('/api/', limiter);

let cache = { value: null, ts: 0 };
const CACHE_TTL = 60_000; 

async function fetchBalanceFromRubep() {
  console.log('Запускаем легковесный браузер со Стелсом...');
  
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--disable-blink-features=AutomationControlled'],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });

  let page;
  try {
    page = await browser.newPage();
    
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('Открываем страницу...');
    // Ждем полной загрузки сети
    await page.goto('https://app.rubep.com/', {
      waitUntil: 'networkidle2', 
      timeout: 60_000
    });

    console.log('Ждем 10 секунд (обход Cloudflare)...');
    await new Promise(r => setTimeout(r, 10000)); 

    console.log('Ищем поле ввода логина...');
    await page.waitForSelector('input[type="email"]', { timeout: 15_000 });
    
    await page.type('input[type="email"]', process.env.RUBEP_LOGIN);
    await page.type('input[type="password"]', process.env.RUBEP_PASSWORD);

    console.log('Ждем ответ от API...');
    const responsePromise = page.waitForResponse(async response => {
      if (response.url().includes('/api/') && response.request().method() === 'GET') {
        try {
          const json = await response.json();
          if (json && json.success && json.data && json.data.cards) return true;
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
    
    if (page) {
      console.log('Делаем скриншот для отладки...');
      // Сохраняем скриншот в публичную папку
      await page.screenshot({ path: './public/error.png' });
      console.log('Скриншот сохранен!');
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
