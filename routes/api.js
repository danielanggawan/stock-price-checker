const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const PROXY_URL =
  "https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/";

// In-memory store.
// This is sufficient for the FCC functional tests and keeps the project
// runnable without requiring a MongoDB account.
const likesByStock = new Map();

function anonymizeIp(ip) {
  // Normalize common IPv4-mapped IPv6 addresses.
  let normalized = String(ip || "")
    .replace(/^::ffff:/, "")
    .trim();

  // Hash the IP before storing it. The raw IP is never saved.
  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");
}

function getClientIp(req) {
  // Respect the first proxy-forwarded address when present.
  // The value is hashed immediately and the raw address is never stored.
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "";
}

function getStockLikes(symbol) {
  if (!likesByStock.has(symbol)) {
    likesByStock.set(symbol, new Set());
  }

  return likesByStock.get(symbol);
}

async function getStock(symbol) {
  const response = await fetch(
    `${PROXY_URL}${encodeURIComponent(symbol)}/quote`
  );

  if (!response.ok) {
    throw new Error(`Stock proxy returned ${response.status}`);
  }

  const data = await response.json();

  // Log the actual response so we can diagnose proxy changes if necessary.
  console.log("Stock proxy response:", data);

  if (!data || typeof data.symbol !== "string") {
    throw new Error("Invalid stock symbol received from proxy");
  }

  // Accept numeric values as well as numeric strings.
  const price = Number(data.latestPrice);

  if (!Number.isFinite(price)) {
    console.error("Invalid stock price received from proxy:", data);
    throw new Error("Invalid stock price received from proxy");
  }

  return {
    stock: data.symbol,
    price
  };
}

async function processStock(symbol, like, anonymizedIp) {
  const stock = await getStock(symbol);
  const likes = getStockLikes(stock.stock);

  if (like === true && !likes.has(anonymizedIp)) {
    likes.add(anonymizedIp);
  }

  return {
    stock: stock.stock,
    price: stock.price,
    likes: likes.size
  };
}

router.get("/stock-prices", async (req, res) => {
  try {
    let stocks = req.query.stock;

    if (!Array.isArray(stocks)) {
      stocks = [stocks];
    }

    stocks = stocks
      .filter((stock) => typeof stock === "string")
      .map((stock) => stock.trim().toUpperCase())
      .filter(Boolean);

    if (stocks.length === 0 || stocks.length > 2) {
      return res.status(400).json({
        error: "Provide one or two NASDAQ stock symbols."
      });
    }

    const like = req.query.like === "true";
    const anonymizedIp = anonymizeIp(getClientIp(req));

    const stockData = await Promise.all(
      stocks.map((symbol) => processStock(symbol, like, anonymizedIp))
    );

    if (stockData.length === 1) {
      return res.json({
        stockData: stockData[0]
      });
    }

    const firstLikes = stockData[0].likes;
    const secondLikes = stockData[1].likes;

    return res.json({
      stockData: stockData.map((stock, index) => ({
        stock: stock.stock,
        price: stock.price,
        rel_likes:
          index === 0
            ? firstLikes - secondLikes
            : secondLikes - firstLikes
      }))
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Unable to retrieve stock price."
    });
  }
});

module.exports = router;

// Exported for tests/development if needed.
module.exports._likesByStock = likesByStock;