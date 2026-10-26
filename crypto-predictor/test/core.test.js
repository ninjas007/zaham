const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { calculateIndicators } = require("../src/indicators/technical");
const { predict } = require("../src/prediction/predictor");
const { trainModel } = require("../src/prediction/mlPredictor");
const PaperTrader = require("../src/paper/paperTrader");
const { scoreTitle } = require("../src/news/sentiment");
const { analyzeTechnical, addProjection } = require("../src/prediction/screener");
const { localExplanation, responseText } = require("../src/prediction/aiProvider");
const AuthService = require("../src/auth/authService");

test("indikator dan prediksi menghasilkan output valid", () => {
	const candles = Array.from({ length: 60 }, (_, index) => ({ close: 100 + index }));
	const indicators = calculateIndicators(candles);
	assert.equal(indicators.ready, true);
	assert.ok(Number.isFinite(indicators.rsi));
	const signal = predict({ ready: true, ema9: 120, ema21: 110, sma20: 115, rsi: 50, macd: { histogram: 2 } }, candles);
	assert.equal(signal.signal, "BUY");
});

test("model ML memberi probabilitas dan hasil backtest", () => {
	const candles = Array.from({ length: 320 }, (_, index) => ({ close: 1000 + index * 2 + Math.sin(index / 5) * 20 }));
	const result = trainModel(candles);
	assert.ok(["NAIK", "TURUN"].includes(result.direction));
	assert.ok(result.probabilityUp >= 0 && result.probabilityUp <= 100);
	assert.ok(result.backtestAccuracy >= 0 && result.backtestAccuracy <= 100);
});

test("sentimen berita membedakan kabar positif dan negatif", () => {
	assert.ok(scoreTitle("Laba naik dan emiten membagikan dividen") > 0);
	assert.ok(scoreTitle("Saham anjlok setelah mencatat kerugian") < 0);
});

test("screener memakai skor konservatif dan validasi historis", () => {
	const closes = Array.from({ length: 260 }, (_, index) => 1000 + index * 1.2 + Math.sin(index / 4) * 30);
	const result = analyzeTechnical({ code: "TEST", price: closes.at(-1), volume: 1000000, marketTime: Date.now(), closes }, new Map());
	assert.ok(result.probabilityUp >= 38 && result.probabilityUp <= 62);
	assert.ok(result.backtestAccuracy >= 0 && result.backtestAccuracy <= 100);
	assert.equal(result.validationSamples, 80);
});

test("proyeksi screener dibatasi dan laba per lot sudah termasuk fee", () => {
	const result = addProjection({ price: 193, probabilityUp: 51.2, volatility: 0.02, dailyMean: 0.01, news: { score: 0 } });
	const quarter = result.projections.find((item) => item.tradingDays === 60);
	assert.ok(Math.abs(quarter.expectedReturn) <= 6.5);
	assert.ok(quarter.profitPerLot < 1200);
});

test("provider AI lokal menjelaskan skenario tanpa menjanjikan hasil", () => {
	const text = localExplanation({ projection: { expectedReturn: 1, label: "1 minggu" }, ret5: 1, ret20: 2, probabilityUp: 54, news: { label: "NETRAL" } });
	assert.match(text, /1 minggu/);
	assert.match(text, /bukan sebagai kepastian/);
});

test("adapter OpenAI membaca teks dari response REST", () => {
	assert.equal(responseText({ output: [{ content: [{ type: "output_text", text: "Analisis server" }] }] }), "Analisis server");
});

test("akun memakai password hash, sesi, dan kuota harian", () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "idx-auth-")), "users.json");
	const auth = new AuthService({ file, dailyQuota: 2, sessionDays: 1 });
	const registered = auth.register({ name: "Penguji", email: "test@example.com", password: "rahasia123" });
	assert.equal(auth.userFromToken(registered.token).email, "test@example.com");
	assert.equal(auth.consumeQuota(auth.userFromToken(registered.token)).remaining, 1);
	assert.equal(auth.login({ email: "test@example.com", password: "rahasia123" }).user.name, "Penguji");
	assert.notEqual(auth.data.users[0].passwordHash, "rahasia123");
});

test("paper trader membeli dan menjual dengan fee", () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kraken-paper-")), "paper.json");
	const trader = new PaperTrader({ file, initialBalance: 1000000, buyFeePercent: 0.15, sellFeePercent: 0.25 });
	trader.buy({ code: "TEST", name: "Test Tbk", price: 1000, lots: 2 });
	assert.equal(trader.state.positions.TEST.shares, 200);
	trader.sell({ code: "TEST", name: "Test Tbk", price: 1100, lots: 2 });
	assert.equal(trader.state.positions.TEST, undefined);
	assert.equal(trader.state.trades.length, 2);
	assert.ok(trader.state.trades[0].pnl > 0);
	const reset = trader.reset(2500000);
	assert.equal(reset.initialBalance, 2500000);
	assert.equal(reset.balance, 2500000);
});
