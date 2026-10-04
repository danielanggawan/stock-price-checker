# Stock Price Checker

A full-stack JavaScript implementation of the freeCodeCamp Stock Price Checker project.

## Features

- GET `/api/stock-prices`
- One stock lookup
- Two stock lookup
- Like stocks with `like=true`
- One like per anonymized IP per stock
- SHA-256 IP anonymization before storage
- Server-side stock proxy request
- Content Security Policy using Helmet
- Five functional tests
- Simple frontend

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000/
```

## Test

Set NODE_ENV to test and run:

```bash
set NODE_ENV=test
npm test
```

On PowerShell:

```powershell
$env:NODE_ENV="test"
npm test
```

On Linux/macOS:

```bash
NODE_ENV=test npm test
```

## API examples

One stock:

```text
/api/stock-prices?stock=GOOG
```

One stock + like:

```text
/api/stock-prices?stock=GOOG&like=true
```

Two stocks:

```text
/api/stock-prices?stock=GOOG&stock=MSFT
```

Two stocks + like:

```text
/api/stock-prices?stock=GOOG&stock=MSFT&like=true
```

## Important note

The like store is intentionally in memory so the project runs without MongoDB. Restarting the server resets the stored likes. For production, use a database and an appropriate privacy/retention policy.
