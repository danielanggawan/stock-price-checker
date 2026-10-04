const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const FCC_PROXY =
  "https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/";

const YAHOO_PROXY =
  "https://query1.finance.yahoo.com/v8/finance/chart/";

// Menyimpan like berdasarkan saham.
// Set digunakan supaya 1 IP hanya bisa like 1 kali.
const likesByStock = new Map();

/**
 * Membuat hash dari IP user.
 * Kita tidak menyimpan IP asli.
 */
function anonymizeIp(ip) {
  const normalized = String(ip || "")
    .replace(/^::ffff:/, "")
    .trim();

  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");
}

/**
 * Mengambil IP client.
 */
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (
    typeof forwarded === "string" &&
    forwarded.length > 0
  ) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "";
}

/**
 * Mengambil Set like untuk sebuah saham.
 */
function getStockLikes(symbol) {
  if (!likesByStock.has(symbol)) {
    likesByStock.set(symbol, new Set());
  }

  return likesByStock.get(symbol);
}

/**
 * Fetch dengan:
 * - timeout 5 detik
 * - retry maksimal 2 kali
 *
 * Ini mencegah API menggantung selamanya
 * jika stock proxy bermasalah.
 */
async function fetchWithRetry(url, attempts = 2) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt++
  ) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 5000);

    try {
      const response = await fetch(url, {
        signal: controller.signal
      });

      if (response.ok) {
        return response;
      }

      lastError = new Error(
        `HTTP ${response.status}`
      );
    } catch (error) {
      if (error.name === "AbortError") {
        lastError = new Error(
          "Request timeout after 5 seconds"
        );
      } else {
        lastError = error;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < attempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, 500)
      );
    }
  }

  throw lastError;
}

/**
 * Mengambil harga saham dari
 * freeCodeCamp stock proxy.
 */
async function getFromFCC(symbol) {
  const url =
    `${FCC_PROXY}${encodeURIComponent(symbol)}/quote`;

  const response = await fetchWithRetry(url, 2);

  const data = await response.json();

  console.log(
    "FCC proxy response:",
    data
  );

  if (
    !data ||
    typeof data !== "object" ||
    typeof data.symbol !== "string"
  ) {
    throw new Error(
      `FCC proxy does not support ${symbol}`
    );
  }

  const price = Number(data.latestPrice);

  if (!Number.isFinite(price)) {
    throw new Error(
      `Invalid FCC price for ${symbol}`
    );
  }

  return {
    stock: data.symbol.toUpperCase(),
    price
  };
}

/**
 * Fallback menggunakan Yahoo Finance
 * jika freeCodeCamp proxy gagal.
 */
async function getFromYahoo(symbol) {
  const url =
    `${YAHOO_PROXY}${encodeURIComponent(symbol)}` +
    "?range=1d&interval=1m";

  const response = await fetchWithRetry(url, 2);

  const data = await response.json();

  const result =
    data?.chart?.result?.[0];

  if (!result) {
    throw new Error(
      `Yahoo Finance has no data for ${symbol}`
    );
  }

  const meta = result.meta || {};

  const price = Number(
    meta.regularMarketPrice ??
    meta.chartPreviousClose
  );

  if (!Number.isFinite(price)) {
    throw new Error(
      `Invalid Yahoo price for ${symbol}`
    );
  }

  return {
    stock: symbol.toUpperCase(),
    price
  };
}

/**
 * Mengambil harga saham.
 *
 * Prioritas:
 * 1. freeCodeCamp proxy
 * 2. Yahoo Finance
 */
async function getStock(symbol) {
  try {
    return await getFromFCC(symbol);
  } catch (fccError) {
    console.warn(
      `FCC proxy failed for ${symbol}:`,
      fccError.message
    );
  }

  try {
    const yahooResult =
      await getFromYahoo(symbol);

    console.log(
      `Yahoo fallback response for ${symbol}:`,
      yahooResult
    );

    return yahooResult;
  } catch (yahooError) {
    console.error(
      `Yahoo fallback failed for ${symbol}:`,
      yahooError.message
    );

    throw new Error(
      `Unable to retrieve stock price for ${symbol}`
    );
  }
}

/**
 * Memproses satu saham.
 */
async function processStock(
  symbol,
  like,
  anonymizedIp
) {
  const stock =
    await getStock(symbol);

  const likes =
    getStockLikes(stock.stock);

  // Hanya tambahkan like jika:
  // - like=true
  // - IP belum pernah like saham tersebut
  if (
    like === true &&
    !likes.has(anonymizedIp)
  ) {
    likes.add(anonymizedIp);
  }

  return {
    stock: stock.stock,
    price: stock.price,
    likes: likes.size
  };
}

/**
 * GET /api/stock-prices
 *
 * Contoh:
 *
 * /api/stock-prices?stock=GOOG
 *
 * /api/stock-prices?stock=GOOG&like=true
 *
 * /api/stock-prices?stock=GOOG&stock=MSFT
 */
router.get(
  "/stock-prices",
  async (req, res) => {
    try {
      let stocks = req.query.stock;

      // Jika hanya satu stock, ubah menjadi array.
      if (!Array.isArray(stocks)) {
        stocks = [stocks];
      }

      // Bersihkan input.
      stocks = stocks
        .filter(
          (stock) =>
            typeof stock === "string"
        )
        .map(
          (stock) =>
            stock.trim().toUpperCase()
        )
        .filter(Boolean);

      // Harus 1 atau 2 saham.
      if (
        stocks.length === 0 ||
        stocks.length > 2
      ) {
        return res.status(400).json({
          error:
            "Provide one or two NASDAQ stock symbols."
        });
      }

      const like =
        req.query.like === "true";

      const clientIp =
        getClientIp(req);

      const anonymizedIp =
        anonymizeIp(clientIp);

      const stockData = [];

      // Diproses satu per satu supaya request
      // tidak membanjiri proxy secara bersamaan.
      for (const symbol of stocks) {
        const data =
          await processStock(
            symbol,
            like,
            anonymizedIp
          );

        stockData.push(data);
      }

      // Jika hanya 1 saham.
      if (stockData.length === 1) {
        return res.json({
          stockData:
            stockData[0]
        });
      }

      // Jika 2 saham:
      // hitung perbedaan jumlah like.
      const firstLikes =
        stockData[0].likes;

      const secondLikes =
        stockData[1].likes;

      return res.json({
        stockData:
          stockData.map(
            (stock, index) => ({
              stock:
                stock.stock,

              price:
                stock.price,

              rel_likes:
                index === 0
                  ? firstLikes -
                    secondLikes
                  : secondLikes -
                    firstLikes
            })
          )
      });
    } catch (error) {
      console.error(
        "Stock Price Checker Error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to retrieve stock price."
      });
    }
  }
);

module.exports = router;

// Export untuk testing/debugging internal.
module.exports._likesByStock =
  likesByStock;