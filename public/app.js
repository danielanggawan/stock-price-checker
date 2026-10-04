const form = document.getElementById("stock-form");
const result = document.getElementById("result");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const first = document.getElementById("stock1").value.trim();
  const second = document.getElementById("stock2").value.trim();
  const like = document.getElementById("like").checked;

  const params = new URLSearchParams();
  params.append("stock", first);

  if (second) {
    params.append("stock", second);
  }

  if (like) {
    params.append("like", "true");
  }

  result.textContent = "Loading...";

  try {
    const response = await fetch(`/api/stock-prices?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    const stocks = Array.isArray(data.stockData)
      ? data.stockData
      : [data.stockData];

    result.innerHTML = stocks
      .map((stock) => {
        const likes = stock.likes ?? stock.rel_likes;
        const likesLabel = stock.likes !== undefined ? "Likes" : "Relative likes";

        return `
          <article class="stock">
            <h2>${escapeHtml(stock.stock)}</h2>
            <p><strong>Price:</strong> $${Number(stock.price).toFixed(2)}</p>
            <p><strong>${likesLabel}:</strong> ${likes}</p>
          </article>
        `;
      })
      .join("");
  } catch (error) {
    result.textContent = error.message;
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}
