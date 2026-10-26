const axios = require("axios");
const { idx, candleLimit } = require("../config");

const client = axios.create({
	baseURL: idx.marketUrl,
	timeout: 15000,
	headers: { "User-Agent": "Mozilla/5.0 IDX Local Simulator" },
});

const sparkClient = axios.create({
	baseURL: "https://query1.finance.yahoo.com/v7/finance/spark",
	timeout: 30000,
	headers: { "User-Agent": "Mozilla/5.0 IDX Local Simulator" },
});

function normalizeCode(value) {
	return String(value || "").toUpperCase().replace(/\.JK$/, "");
}

function numeric(value) {
	return value === null || value === undefined || value === "" ? null : Number(value);
}

async function getMarketData(code) {
	const cleanCode = normalizeCode(code);
	if (!/^[A-Z0-9.-]{2,12}$/.test(cleanCode)) throw new Error("Kode saham tidak valid");
	const response = await client.get(`/${encodeURIComponent(`${cleanCode}.JK`)}`, {
		params: { range: "5d", interval: "5m", includePrePost: false, events: "div,splits" },
	});
	const result = response.data?.chart?.result?.[0];
	const apiError = response.data?.chart?.error;
	if (!result) throw new Error(apiError?.description || `Data ${cleanCode} tidak tersedia`);

	const quote = result.indicators?.quote?.[0] || {};
	const timestamps = result.timestamp || [];
	const candles = timestamps.map((timestamp, index) => ({
		openTime: timestamp * 1000,
		open: numeric(quote.open?.[index]),
		high: numeric(quote.high?.[index]),
		low: numeric(quote.low?.[index]),
		close: numeric(quote.close?.[index]),
		volume: Number(quote.volume?.[index] || 0),
	})).filter((item) => [item.open, item.high, item.low, item.close].every(Number.isFinite)).slice(-candleLimit);

	const meta = result.meta || {};
	const lastCandle = candles[candles.length - 1];
	const price = Number(meta.regularMarketPrice ?? lastCandle?.close);
	if (!Number.isFinite(price)) throw new Error(`Harga ${cleanCode} tidak tersedia`);
	return {
		code: cleanCode,
		symbol: `${cleanCode}.JK`,
		name: meta.longName || meta.shortName || cleanCode,
		currency: meta.currency || "IDR",
		exchange: meta.fullExchangeName || "Jakarta",
		price,
		previousClose: Number(meta.chartPreviousClose ?? meta.previousClose ?? price),
		dayHigh: Number(meta.regularMarketDayHigh ?? lastCandle?.high ?? price),
		dayLow: Number(meta.regularMarketDayLow ?? lastCandle?.low ?? price),
		volume: Number(meta.regularMarketVolume ?? lastCandle?.volume ?? 0),
		marketTime: Number(meta.regularMarketTime || lastCandle?.openTime / 1000) * 1000,
		delayMinutes: Number(meta.exchangeDataDelayedBy ?? 10),
		timezone: meta.exchangeTimezoneName || "Asia/Jakarta",
		candles,
	};
}

async function getLatestPrice(code) {
	const cleanCode = normalizeCode(code);
	const response = await client.get(`/${encodeURIComponent(`${cleanCode}.JK`)}`, {
		params: { range: "1d", interval: "1d", includePrePost: false },
	});
	const result = response.data?.chart?.result?.[0];
	const apiError = response.data?.chart?.error;
	if (!result) throw new Error(apiError?.description || `Harga ${cleanCode} tidak tersedia`);
	const close = result.indicators?.quote?.[0]?.close?.filter(Number.isFinite).at(-1);
	const price = Number(result.meta?.regularMarketPrice ?? close);
	if (!Number.isFinite(price)) throw new Error(`Harga ${cleanCode} tidak tersedia`);
	return { code: cleanCode, price, marketTime: Number(result.meta?.regularMarketTime || Date.now() / 1000) * 1000 };
}

const HISTORY_RANGES = {
	"1w": { range: "5d", interval: "15m" },
	"1m": { range: "1mo", interval: "30m" },
	"6m": { range: "6mo", interval: "1d" },
	"1y": { range: "1y", interval: "1d" },
	"5y": { range: "5y", interval: "1d" },
};

async function getHistoricalData(code, requestedRange = "1m") {
	const cleanCode = normalizeCode(code);
	const selection = HISTORY_RANGES[requestedRange] || HISTORY_RANGES["1m"];
	const response = await client.get(`/${encodeURIComponent(`${cleanCode}.JK`)}`, {
		params: { ...selection, includePrePost: false, events: "div,splits" },
	});
	const result = response.data?.chart?.result?.[0];
	const apiError = response.data?.chart?.error;
	if (!result) throw new Error(apiError?.description || `Riwayat ${cleanCode} tidak tersedia`);
	const quote = result.indicators?.quote?.[0] || {};
	const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
	const candles = (result.timestamp || []).map((timestamp, index) => ({
		openTime: timestamp * 1000,
		open: numeric(quote.open?.[index]),
		high: numeric(quote.high?.[index]),
		low: numeric(quote.low?.[index]),
		close: numeric(quote.close?.[index]),
		adjustedClose: numeric(adjusted[index] ?? quote.close?.[index]),
		volume: Number(quote.volume?.[index] || 0),
	})).filter((item) => [item.open, item.high, item.low, item.close].every(Number.isFinite));
	return { code: cleanCode, range: requestedRange, interval: selection.interval, currency: result.meta?.currency || "IDR", candles };
}

async function getBatchMarketData(codes) {
	const symbols = codes.map((code) => `${normalizeCode(code)}.JK`).join(",");
	const response = await sparkClient.get("", { params: { symbols, range: "1y", interval: "1d" } });
	return (response.data?.spark?.result || []).map((item) => {
		const data = item.response?.[0];
		const closes = (data?.indicators?.quote?.[0]?.close || []).filter((value) => value !== null && Number.isFinite(Number(value))).map(Number);
		return {
			code: normalizeCode(item.symbol),
			price: numeric(data?.meta?.regularMarketPrice ?? closes.at(-1)),
			volume: numeric(data?.meta?.regularMarketVolume ?? 0),
			marketTime: Number(data?.meta?.regularMarketTime || 0) * 1000,
			closes,
		};
	}).filter((item) => Number.isFinite(item.price) && item.price > 0 && item.closes.length >= 22);
}

module.exports = { getMarketData, getLatestPrice, getHistoricalData, getBatchMarketData, normalizeCode };
