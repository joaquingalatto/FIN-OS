import { EXCHANGE_RATE_TYPES, fallbackExchangeRates } from "./finance-data.js";

const API_URL = "https://dolarapi.com/v1/dolares";

export async function fetchExchangeRates() {
  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rows = await response.json();
    const mapped = EXCHANGE_RATE_TYPES.reduce((acc, rateType) => {
      const row = rows.find((item) => item.casa === rateType.apiCasa);
      if (!row) return acc;

      acc[rateType.id] = {
        type: rateType.id,
        label: rateType.label,
        buy: Number(row.compra || 0),
        sell: Number(row.venta || row.compra || 0),
        updatedAt: row.fechaActualizacion,
        source: "DolarApi",
      };
      return acc;
    }, {});

    if (!mapped.blue && !mapped.official && !mapped.mep) {
      throw new Error("No compatible exchange rates");
    }

    return {
      rates: { ...fallbackExchangeRates, ...mapped },
      status: "online",
      message: "Cotizacion actualizada",
    };
  } catch (error) {
    return {
      rates: fallbackExchangeRates,
      status: "error",
      message: "No se pudo obtener la cotizacion. Se usa fallback local.",
      error,
    };
  }
}

export function isRateStale(rate) {
  if (!rate?.updatedAt) return true;
  const updated = new Date(rate.updatedAt).getTime();
  if (Number.isNaN(updated)) return true;
  const diffHours = (Date.now() - updated) / 36e5;
  return diffHours > 8;
}

export const storage = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};
