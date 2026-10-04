const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const FCC_PROXY =
  "https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/";

const YAHOO_PROXY =
  "https://query1.finance.yahoo.com/v8/finance/chart/";

const likesByStock = new Map();

/*
 * =========================================================
 * IP ANONYMIZATION
 * =========================================================
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

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "";
}

/*
 * =========================================================
 * LIKE STORAGE
 * =========================================================
 */

function getStockLikes(symbol) {
  if (!likesByStock.has(symbol)) {
    likesByStock.set(symbol, new Set());
  }

  return likesByStock.get(symbol);
}

/*
 * =========================================================
 * FETCH WITH RETRY
 * =========================================================
 */

async function fetchWithRetry(url, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return response;
      }

      lastError = new Error(
        `HTTP ${response.status}`
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, 500)
      );
    }
  }

  throw lastError;
}

/*
 * =========================================================
 * FREECODECAMP STOCK API
 * =========================================================
 */

async function getFromFCC(symbol) {
  const url =
    `${FCC_PROXY}${encodeURIComponent(symbol)}/quote`;

  const response = await fetchWithRetry(url, 3);

  const data = await response.json();

  console.log("FCC proxy response:", data);

  /*
   * FCC proxy dapat mengembalikan:
   *
   * {
   *   symbol: "GOOG",
   *   latestPrice: 340.35
   * }
   *
   * atau:
   *
   * "Unknown symbol"
   */

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

/*
 * =========================================================
 * YAHOO FINANCE FALLBACK
 * =========================================================
 *
 * Digunakan jika proxy freeCodeCamp gagal.
 *
 * Contoh:
 *
 * FCC  -> MSFT -> Unknown symbol
 * Yahoo -> MSFT -> 517.53
 *
 * Ini diperlukan karena proxy FCC saat ini tidak selalu
 * memberikan data MSFT.
 */

async function getFromYahoo(symbol) {
  const url =
    `${YAHOO_PROXY}${encodeURIComponent(symbol)}` +
    "?range=1d&interval=1m";

  const response = await fetchWithRetry(url, 3);

  const data = await response.json();

  const result = data?.chart?.result?.[0];

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

/*
 * =========================================================
 * GET STOCK
 * =========================================================
 */

async function getStock(symbol) {
  /*
   * Pertama selalu mencoba proxy resmi freeCodeCamp.
   */
  try {
    return await getFromFCC(symbol);
  } catch (fccError) {
    console.warn(
      `FCC proxy failed for ${symbol}:`,
      fccError.message
    );
  }

  /*
   * Kalau FCC gagal, gunakan Yahoo sebagai fallback.
   */
  try {
    const fallback = await getFromYahoo(symbol);

    console.log(
      `Yahoo fallback response for ${symbol}:`,
      fallback
    );

    return fallback;
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

/*
 * =========================================================
 * PROCESS STOCK
 * =========================================================
 */

async function processStock(
  symbol,
  like,
  anonymizedIp
) {
  const stock = await getStock(symbol);

  const likes = getStockLikes(stock.stock);

  /*
   * Like hanya dihitung satu kali untuk IP yang sama.
   *
   * Kalau user melakukan like kedua kali:
   *
   * likes.has(...) === true
   *
   * maka kita TIDAK menambah like lagi.
   *
   * Request tetap 200 OK.
   */
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

/*
 * =========================================================
 * GET /api/stock-prices
 * =========================================================
 */

router.get(
  "/stock-prices",
  async (req, res) => {
    try {
      let stocks = req.query.stock;

      /*
       * Kalau hanya satu stock:
       *
       * ?stock=GOOG
       *
       * Express memberikan string.
       *
       * Kalau dua stock:
       *
       * ?stock=GOOG&stock=MSFT
       *
       * Express memberikan array.
       */

      if (!Array.isArray(stocks)) {
        stocks = [stocks];
      }

      /*
       * Bersihkan input.
       */

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

      /*
       * FCC hanya membutuhkan 1 atau 2 saham.
       */

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

      const anonymizedIp =
        anonymizeIp(
          getClientIp(req)
        );

      /*
       * Proses saham satu per satu.
       *
       * Ini sengaja tidak menggunakan Promise.all()
       * supaya proxy tidak ditembak bersamaan.
       */

      const stockData = [];

      for (const symbol of stocks) {
        const data =
          await processStock(
            symbol,
            like,
            anonymizedIp
          );

        stockData.push(data);
      }

      /*
       * =====================================================
       * SATU STOCK
       * =====================================================
       */

      if (stockData.length === 1) {
        return res.json({
          stockData:
            stockData[0]
        });
      }

      /*
       * =====================================================
       * DUA STOCK
       * =====================================================
       *
       * FCC meminta:
       *
       * stock pertama:
       * likes1 - likes2
       *
       * stock kedua:
       * likes2 - likes1
       */

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

/*
 * =========================================================
 * EXPORT
 * =========================================================
 */

module.exports = router;

module.exports._likesByStock =
  likesByStock;