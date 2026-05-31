export function getRate(rates, type = "blue") {
  const rate = rates?.[type] || rates?.blue || Object.values(rates || {})[0];
  return Number(rate?.sell || rate?.venta || 1);
}

export function toARS(value, currency, exchangeRate) {
  const amount = Number(value || 0);
  return currency === "USD" ? amount * Number(exchangeRate || 1) : amount;
}

export function fromARS(value, currency, exchangeRate) {
  const amount = Number(value || 0);
  return currency === "USD" ? amount / Number(exchangeRate || 1) : amount;
}

export function movementToARS(item) {
  return toARS(item.amount, item.currency, item.exchangeRate);
}

export function investmentValueToARS(item, rates, defaultRateType) {
  const rate = getRate(rates, defaultRateType);
  return toARS(item.currentValue, item.currency, item.exchangeRate || rate);
}

export function convertFromARS(amountARS, displayCurrency, rates, defaultRateType) {
  if (displayCurrency === "USD") {
    return fromARS(amountARS, "USD", getRate(rates, defaultRateType));
  }
  return amountARS;
}

export function formatMoney(amount, currency = "ARS", compact = false) {
  const value = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

export function formatPercent(value) {
  const number = Number.isFinite(value) ? value : 0;
  return `${number > 0 ? "+" : ""}${number.toFixed(1)}%`;
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`));
}
