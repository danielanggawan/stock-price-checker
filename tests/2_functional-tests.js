const chai = require("chai");
const assert = chai.assert;
const request = require("supertest");

const app = require("../server");

describe("Functional Tests", function () {
  it("Viewing one stock: GET request to /api/stock-prices/", async function () {
    const res = await request(app)
      .get("/api/stock-prices/")
      .query({ stock: "GOOG" })
      .expect(200);

    assert.exists(res.body.stockData);
    assert.isString(res.body.stockData.stock);
    assert.isNumber(res.body.stockData.price);
    assert.isNumber(res.body.stockData.likes);
  });

  it("Viewing one stock and liking it: GET request to /api/stock-prices/", async function () {
    const res = await request(app)
      .get("/api/stock-prices/")
      .query({ stock: "GOOG", like: "true" })
      .set("X-Forwarded-For", "203.0.113.10")
      .expect(200);

    assert.exists(res.body.stockData);
    assert.isNumber(res.body.stockData.likes);
    assert.isAtLeast(res.body.stockData.likes, 1);
  });

  it("Viewing the same stock and liking it again: GET request to /api/stock-prices/", async function () {
    const res = await request(app)
      .get("/api/stock-prices/")
      .query({ stock: "GOOG", like: "true" })
      .set("X-Forwarded-For", "203.0.113.10")
      .expect(200);

    assert.exists(res.body.stockData);
    assert.isNumber(res.body.stockData.likes);
  });

  it("Viewing two stocks: GET request to /api/stock-prices/", async function () {
    const res = await request(app)
      .get("/api/stock-prices/")
      .query({ stock: ["GOOG", "MSFT"] })
      .expect(200);

    assert.isArray(res.body.stockData);
    assert.lengthOf(res.body.stockData, 2);

    res.body.stockData.forEach((stock) => {
      assert.isString(stock.stock);
      assert.isNumber(stock.price);
      assert.isNumber(stock.rel_likes);
    });
  });

  it("Viewing two stocks and liking them: GET request to /api/stock-prices/", async function () {
    const res = await request(app)
      .get("/api/stock-prices/")
      .query({ stock: ["GOOG", "MSFT"], like: "true" })
      .set("X-Forwarded-For", "203.0.113.20")
      .expect(200);

    assert.isArray(res.body.stockData);
    assert.lengthOf(res.body.stockData, 2);

    res.body.stockData.forEach((stock) => {
      assert.isString(stock.stock);
      assert.isNumber(stock.price);
      assert.isNumber(stock.rel_likes);
    });
  });
});
