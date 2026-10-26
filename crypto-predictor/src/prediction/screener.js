const { getBatchMarketData } = require("../idx/market");
const { getNewsSentiment } = require("../news/sentiment");
const config = require("../config");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function idxTick(price) {
	if (price < 200) return 1;
	if (price < 500) return 2;
	if (price < 2000) return 5;
	if (price < 5000) return 10;
	return 25;
}

function roundIdxPrice(price) {
	const tick = idxTick(price);
	return Math.max(tick, Math.round(price / tick) * tick);
}

function technicalScore(closes, endIndex = closes.length - 1) {
	const window = closes.slice(0, endIndex + 1);
	if (window.length < 22) return null;
	const returns = window.slice(1).map((value, index) => value / window[index] - 1).filter((value) => Math.abs(value) < 0.35);
	const recentReturns = returns.slice(-20);
	const dailyMean = mean(recentReturns);
	const variance = mean(recentReturns.map((value) => (value - dailyMean) ** 2));
	const volatility = Math.sqrt(variance) || 0.01;
	const ret5 = window.at(-1) / window.at(-6) - 1;
	const ret20 = window.at(-1) / window.at(-21) - 1;
	const sma5 = mean(window.slice(-5));
	const sma20 = mean(window.slice(-20));
	const trend = sma5 / sma20 - 1;
	const lastReturn = returns.at(-1) || 0;
	const z = 0.35 * ret5 / (volatility * Math.sqrt(5)) + 0.25 * ret20 / (volatility * Math.sqrt(20)) + 0.25 * trend / volatility + 0.15 * lastReturn / volatility;
	return { z: clamp(z, -4, 4), ret5, ret20, volatility, dailyMean };
}

function analyzeTechnical(stock, names) {
	const current = technicalScore(stock.closes);
	const history = [];
	for (let index = 21; index < stock.closes.length - 1; index += 1) {
		const score = technicalScore(stock.closes, index);
		if (score) history.push({ score: score.z, wentUp: stock.closes[index + 1] > stock.closes[index] });
	}
	const neighbors = history
		.sort((a, b) => Math.abs(a.score - current.z) - Math.abs(b.score - current.z))
		.slice(0, 48);
	const upCount = neighbors.filter((row) => row.wentUp).length;
	// Prior seimbang yang kuat mencegah sampel kecil menghasilkan klaim ekstrem.
	const empiricalProbability = ((upCount + 30) / (neighbors.length + 60)) * 100;
	const directionalProbability = 50 + 6 * Math.tanh(current.z);
	const technicalProbability = clamp(empiricalProbability * 0.7 + directionalProbability * 0.3, 38, 62);
	const validation = history.slice(-80);
	const correct = validation.filter((row) => (row.score >= 0) === row.wentUp).length;
	const backtestAccuracy = validation.length ? (correct / validation.length) * 100 : 50;
	return { code: stock.code, name: names.get(stock.code) || stock.code, price: stock.price, volume: stock.volume, marketTime: stock.marketTime, technicalProbability, probabilityUp: technicalProbability, backtestAccuracy, validationSamples: validation.length, ret5: current.ret5 * 100, ret20: current.ret20 * 100, volatility: current.volatility, dailyMean: current.dailyMean, news: null };
}

function addProjection(item) {
	const newsDrift = (item.news?.score || 0) * 0.00005;
	const signalDrift = (item.probabilityUp / 100 - 0.5) * item.volatility * 0.12;
	const dailyDrift = clamp(item.dailyMean * 0.03 + signalDrift + newsDrift, -0.0008, 0.0008);
	item.projections = [
		{ tradingDays: 1, label: "1 hari", maxReturn: 0.008 },
		{ tradingDays: 5, label: "1 minggu", maxReturn: 0.015 },
		{ tradingDays: 20, label: "1 bulan", maxReturn: 0.03 },
		{ tradingDays: 60, label: "3 bulan", maxReturn: 0.06 },
		{ tradingDays: 252, label: "1 tahun", maxReturn: 0.12 },
	].map((horizon) => {
		const rawExpectedReturn = clamp(Math.exp(dailyDrift * horizon.tradingDays) - 1, -horizon.maxReturn, horizon.maxReturn);
		const expectedPrice = roundIdxPrice(item.price * (1 + rawExpectedReturn));
		const expectedReturn = expectedPrice / item.price - 1;
		const uncertainty = clamp(item.volatility * Math.sqrt(horizon.tradingDays), 0, horizon.maxReturn * 2);
		const buyCost = item.price * 100 * (1 + config.buyFeePercent / 100);
		const sellProceeds = expectedPrice * 100 * (1 - config.sellFeePercent / 100);
		return { tradingDays: horizon.tradingDays, label: horizon.label, expectedReturn: Number((expectedReturn * 100).toFixed(2)), expectedPrice, profitPerLot: Math.round(sellProceeds - buyCost), lowReturn: Number(((expectedReturn - uncertainty) * 100).toFixed(2)), highReturn: Number(((expectedReturn + uncertainty) * 100).toFixed(2)) };
	});
	return item;
}

async function scanStocks(catalog, onProgress = () => {}) {
	const names = new Map(catalog.map((stock) => [stock.code, stock.name]));
	const analyzed = [];
	const batchSize = 20;
	for (let index = 0; index < catalog.length; index += batchSize) {
		try {
			const marketRows = await getBatchMarketData(catalog.slice(index, index + batchSize).map((stock) => stock.code));
			analyzed.push(...marketRows.filter((stock) => stock.volume >= 100000).map((stock) => analyzeTechnical(stock, names)));
		} catch {}
		onProgress(Math.min(catalog.length, index + batchSize), catalog.length);
		if (index + batchSize < catalog.length) await sleep(100);
	}
	if (!analyzed.length) throw new Error("Tidak ada data yang berhasil dipindai");
	analyzed.forEach(addProjection);
	const sorted = [...analyzed].sort((a, b) => b.technicalProbability - a.technicalProbability);
	const candidates = [...new Map([...sorted.slice(0, 15), ...sorted.slice(-15)].map((item) => [item.code, item])).values()];
	for (let index = 0; index < candidates.length; index += 5) {
		const batch = candidates.slice(index, index + 5);
		await Promise.all(batch.map(async (item) => {
			try { item.news = await getNewsSentiment(item.code, item.name); }
			catch { item.news = { score: 0, label: "TIDAK TERSEDIA", articleCount: 0, articles: [] }; }
			item.probabilityUp = clamp(item.technicalProbability + item.news.score * 3, 38, 62);
			addProjection(item);
		}));
	}
	const up = candidates.filter((item) => item.probabilityUp >= 50).sort((a, b) => b.probabilityUp - a.probabilityUp).slice(0, 12);
	const down = candidates.filter((item) => item.probabilityUp < 50).sort((a, b) => a.probabilityUp - b.probabilityUp).slice(0, 12);
	const analyzedCodes = new Set(analyzed.map((item) => item.code));
	const skipped = catalog.filter((stock) => !analyzedCodes.has(stock.code)).map((stock) => ({ code: stock.code, name: stock.name }));
	return { generatedAt: new Date().toISOString(), scanned: catalog.length, analyzed: analyzed.length, all: analyzed.sort((a, b) => b.probabilityUp - a.probabilityUp), skipped, up, down, methodology: "skor walk-forward 1 tahun; proyeksi konservatif dibatasi ±1,5% / ±3% / ±6% sebelum fraksi harga dan fee", disclaimer: "Skor pemeringkatan dan estimasi statistik, bukan peluang pasti, jaminan keuntungan, atau rekomendasi investasi." };
}

module.exports = { scanStocks, analyzeTechnical, addProjection, roundIdxPrice };
