const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer, WebSocket } = require("ws");
const config = require("./config");
const { loadCatalog } = require("./idx/catalog");
const { getMarketData, getLatestPrice, getHistoricalData, normalizeCode } = require("./idx/market");
const { calculateIndicators } = require("./indicators/technical");
const { predict } = require("./prediction/predictor");
const { trainModel } = require("./prediction/mlPredictor");
const { scanStocks, roundIdxPrice } = require("./prediction/screener");
const { explainScenario } = require("./prediction/aiProvider");
const PaperTrader = require("./paper/paperTrader");
const AuthService = require("./auth/authService");

const app = express();
const server = http.createServer(app);
const browserSocket = new WebSocketServer({ server, path: "/ws" });
const guestPaperTrader = new PaperTrader();
const userPaperTraders = new Map();
const authService = new AuthService({ file: config.auth.usersFile, dailyQuota: config.ai.dailyQuota, sessionDays: config.auth.sessionDays });
const loginAttempts = new Map();

const state = {
	provider: "Yahoo Finance",
	catalogSource: "KSEI",
	connected: false,
	status: "Memuat daftar saham Indonesia...",
	selectedCode: config.symbol,
	selectedName: config.symbol,
	stockCount: 0,
	catalogUpdatedAt: null,
	market: null,
	indicators: { ready: false },
	prediction: { signal: "HOLD", confidence: 0, score: 0, reasons: [] },
	lastUpdate: null,
	error: null,
};

let catalog = [];
let refreshTimer = null;
let screenerTimer = null;
let refreshing = false;
let bootstrapPromise = null;
let portfolioCursor = 0;
const historyCache = new Map();
const aiCache = new Map();
const screenerState = { running: false, completed: 0, total: 0, selectedCodes: [], result: null, error: null };

app.use(express.json());
app.use((request, response, next) => {
	response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
	response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
	response.setHeader("X-Content-Type-Options", "nosniff");
	next();
});
app.use(express.static(path.join(__dirname, "..", "public")));

function cookies(request) {
	return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function sessionCookie(token = "", expired = false) {
	return `idx_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; ${config.auth.secureCookie ? "Secure; " : ""}${expired ? "Max-Age=0" : `Max-Age=${config.auth.sessionDays * 86400}`}`;
}

function currentUser(request) {
	return authService.userFromToken(cookies(request).idx_session);
}

function requireUser(request, response, next) {
	const user = currentUser(request);
	if (!user) return response.status(401).json({ error: "Silakan masuk untuk menggunakan analisis AI" });
	request.user = user;
	next();
}

function requireAiUser(request, response, next) {
	if (config.ai.provider === "local") {
		request.user = currentUser(request);
		return next();
	}
	return requireUser(request, response, next);
}

function checkLoginRate(request, response, next) {
	const key = request.ip || request.socket.remoteAddress || "unknown";
	const now = Date.now();
	const recent = (loginAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
	if (recent.length >= 12) return response.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." });
	recent.push(now); loginAttempts.set(key, recent); next();
}

function traderFor(user) {
	if (!user) return guestPaperTrader;
	if (!userPaperTraders.has(user.id)) {
		const file = path.join(path.dirname(path.resolve(config.paperFile)), "users", `${user.id}.json`);
		userPaperTraders.set(user.id, new PaperTrader({ file }));
	}
	return userPaperTraders.get(user.id);
}

function publicState(user = null) {
	const priceMap = state.market ? { [state.market.code]: state.market.price } : {};
	return { ...state, paper: traderFor(user).snapshot(priceMap), autoTrade: false };
}

function broadcast() {
	for (const client of browserSocket.clients) {
		if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "state", data: publicState(client.authUser) }));
	}
}

async function refreshMarket() {
	if (refreshing) return;
	refreshing = true;
	try {
		const market = await getMarketData(state.selectedCode);
		const catalogItem = catalog.find((item) => item.code === market.code);
		market.name = catalogItem?.name || market.name;
		state.market = market;
		state.selectedName = market.name;
		state.indicators = calculateIndicators(market.candles);
		state.prediction = predict(state.indicators, market.candles);
		state.connected = true;
		state.status = market.delayMinutes > 0 ? `Harga pasar terlambat ${market.delayMinutes} menit` : "Harga pasar live";
		state.lastUpdate = new Date().toISOString();
		state.error = null;
		guestPaperTrader.updatePrice(market.code, market.price);
		for (const trader of userPaperTraders.values()) trader.updatePrice(market.code, market.price);
		await refreshPortfolioPrices();
	} catch (error) {
		state.connected = false;
		state.status = "Sumber harga tidak terhubung";
		state.error = error.message;
	} finally {
		refreshing = false;
		broadcast();
	}
}

async function refreshPortfolioPrices() {
	const traders = [guestPaperTrader, ...userPaperTraders.values()];
	const codes = [...new Set(traders.flatMap((trader) => Object.keys(trader.state.positions)))].filter((code) => code !== state.selectedCode);
	if (!codes.length) return;
	const count = Math.min(3, codes.length);
	const batch = Array.from({ length: count }, (_, offset) => codes[(portfolioCursor + offset) % codes.length]);
	portfolioCursor = (portfolioCursor + count) % codes.length;
	const results = await Promise.allSettled(batch.map(getLatestPrice));
	for (const result of results) {
		if (result.status === "fulfilled") for (const trader of traders) trader.updatePrice(result.value.code, result.value.price);
	}
}

async function bootstrap({ scheduleRefresh = true } = {}) {
	const loaded = await loadCatalog();
	catalog = loaded.stocks;
	state.stockCount = catalog.length;
	state.catalogUpdatedAt = loaded.fetchedAt;
	const initial = catalog.find((item) => item.code === state.selectedCode) || catalog[0];
	state.selectedCode = initial.code;
	state.selectedName = initial.name;
	await refreshMarket();
	if (!scheduleRefresh) return;
	refreshTimer = setInterval(refreshMarket, config.idx.refreshMs);
	screenerTimer = setInterval(() => {
		if (screenerState.selectedCodes.length) {
			const selected = new Set(screenerState.selectedCodes);
			startScreenerScan(catalog.filter((stock) => selected.has(stock.code)));
		}
	}, config.idx.screenerRefreshMs);
}

function ensureBootstrapped() {
	if (!bootstrapPromise) bootstrapPromise = bootstrap({ scheduleRefresh: !process.env.VERCEL });
	return bootstrapPromise;
}

// A Vercel function is invoked without server.listen(), so initialize the
// in-memory state before each API request (once per warm instance).
app.use("/api", async (request, response, next) => {
	try {
		await ensureBootstrapped();
		next();
	} catch (error) {
		state.error = error.message;
		state.status = "Gagal memuat katalog saham";
		response.status(503).json({ error: state.status, detail: error.message });
	}
});

function startScreenerScan(scope = catalog) {
	if (screenerState.running || !scope.length) return false;
	screenerState.running = true;
	screenerState.completed = 0;
	screenerState.total = scope.length;
	screenerState.selectedCodes = scope.map((stock) => stock.code);
	screenerState.error = null;
	Promise.resolve()
		.then(() => scanStocks(scope, (completed, total) => { screenerState.completed = completed; screenerState.total = total; }))
		.then((result) => { screenerState.result = result; })
		.catch((error) => { screenerState.error = error.message; })
		.finally(() => { screenerState.running = false; });
	return true;
}

browserSocket.on("connection", (socket, request) => { socket.authUser = currentUser(request); socket.send(JSON.stringify({ type: "state", data: publicState(socket.authUser) })); });

app.get("/api/health", (request, response) => response.json({
	ok: Boolean(state.market && catalog.length),
	provider: state.provider,
	connected: state.connected,
	selectedCode: state.selectedCode,
	price: state.market?.price || null,
	stockCount: catalog.length,
	marketTime: state.market?.marketTime || null,
	delayMinutes: state.market?.delayMinutes ?? null,
	aiProvider: config.ai.provider,
	aiConfigured: config.ai.provider === "local" || Boolean(config.ai.apiKey && config.ai.model),
	error: state.error,
}));

app.get("/api/state", (request, response) => response.json(publicState(currentUser(request))));

app.get("/api/auth/me", (request, response) => {
	const user = currentUser(request);
	response.json({ authenticated: Boolean(user), user: user ? authService.publicUser(user) : null, registrationEnabled: config.auth.allowRegistration });
});

app.post("/api/auth/register", checkLoginRate, (request, response) => {
	try {
		if (!config.auth.allowRegistration) throw new Error("Pendaftaran akun sedang ditutup");
		const result = authService.register(request.body || {});
		response.setHeader("Set-Cookie", sessionCookie(result.token));
		response.status(201).json({ authenticated: true, user: result.user });
	} catch (error) { response.status(400).json({ error: error.message }); }
});

app.post("/api/auth/login", checkLoginRate, (request, response) => {
	try {
		const result = authService.login(request.body || {});
		response.setHeader("Set-Cookie", sessionCookie(result.token));
		response.json({ authenticated: true, user: result.user });
	} catch (error) { response.status(401).json({ error: error.message }); }
});

app.post("/api/auth/logout", (request, response) => {
	authService.logout(cookies(request).idx_session);
	response.setHeader("Set-Cookie", sessionCookie("", true));
	response.json({ authenticated: false });
});

app.get("/api/stocks", (request, response) => {
	const search = String(request.query.search || "").trim().toLowerCase();
	const page = Math.max(1, Number(request.query.page) || 1);
	const limit = Math.min(1000, Math.max(10, Number(request.query.limit) || 50));
	const filtered = search
		? catalog.filter((stock) => stock.code.toLowerCase().includes(search) || stock.name.toLowerCase().includes(search))
		: catalog;
	const start = (page - 1) * limit;
	response.json({ stocks: filtered.slice(start, start + limit), total: filtered.length, page, pages: Math.max(1, Math.ceil(filtered.length / limit)), source: state.catalogSource, updatedAt: state.catalogUpdatedAt });
});

app.get("/api/history/:code", async (request, response) => {
	try {
		const code = normalizeCode(request.params.code);
		if (!catalog.some((item) => item.code === code)) throw new Error(`${code} tidak ada di katalog KSEI`);
		const range = String(request.query.range || "1m").toLowerCase();
		if (!["1w", "1m", "6m", "1y", "5y"].includes(range)) throw new Error("Range harus 1w, 1m, 6m, 1y, atau 5y");
		const key = `${code}:${range}`;
		const cached = historyCache.get(key);
		if (cached && Date.now() - cached.time < 5 * 60 * 1000) return response.json(cached.data);
		const data = await getHistoricalData(code, range);
		historyCache.set(key, { time: Date.now(), data });
		response.json(data);
	} catch (error) {
		response.status(400).json({ error: error.message });
	}
});

app.get("/api/ai/:code", async (request, response) => {
	try {
		const code = normalizeCode(request.params.code);
		if (!catalog.some((item) => item.code === code)) throw new Error(`${code} tidak ada di katalog KSEI`);
		const cached = aiCache.get(code);
		if (cached && Date.now() - cached.time < 15 * 60 * 1000) return response.json(cached.data);
		let history = historyCache.get(`${code}:5y`)?.data;
		if (!history) {
			history = await getHistoricalData(code, "5y");
			historyCache.set(`${code}:5y`, { time: Date.now(), data: history });
		}
		const data = { code, ...trainModel(history.candles), generatedAt: new Date().toISOString(), disclaimer: "Probabilitas statistik, bukan kepastian atau rekomendasi investasi." };
		aiCache.set(code, { time: Date.now(), data });
		response.json(data);
	} catch (error) {
		response.status(400).json({ error: error.message });
	}
});

app.get("/api/screener", (request, response) => response.json(screenerState));

app.post("/api/screener/scan", (request, response) => {
	if (screenerState.running) return response.status(202).json(screenerState);
	const requestedCodes = Array.isArray(request.body.codes)
		? [...new Set(request.body.codes.map(normalizeCode))]
		: [];
	const requested = new Set(requestedCodes);
	const scope = request.body.all === true
		? catalog
		: catalog.filter((stock) => requested.has(stock.code));
	if (!scope.length) return response.status(400).json({ error: "Pilih minimal satu saham untuk dipindai" });
	startScreenerScan(scope);
	response.status(202).json(screenerState);
});

app.post("/api/scenario", requireAiUser, async (request, response) => {
	try {
		const code = normalizeCode(request.body.code);
		const lots = Number(request.body.lots);
		const tradingDays = Number(request.body.tradingDays);
		const stock = catalog.find((item) => item.code === code);
		if (!stock) throw new Error(`${code} tidak ada di katalog KSEI`);
		if (!Number.isInteger(lots) || lots < 1 || lots > 100000) throw new Error("Jumlah lot tidak valid");
		if (![1, 5, 20, 60, 252].includes(tradingDays)) throw new Error("Horizon tidak valid");
		const scan = await scanStocks([stock]);
		const item = scan.all[0];
		const projection = item.projections.find((row) => row.tradingDays === tradingDays);
		const settings = traderFor(request.user).snapshot().settings;
		const calculate = (targetPrice) => Math.round(targetPrice * lots * 100 * (1 - settings.sellFeePercent / 100) - item.price * lots * 100 * (1 + settings.buyFeePercent / 100));
		const bearPrice = roundIdxPrice(item.price * (1 + projection.lowReturn / 100));
		const bullPrice = roundIdxPrice(item.price * (1 + projection.highReturn / 100));
		const targetDate = new Date(Date.now() + Math.ceil(tradingDays * 7 / 5) * 86400000).toISOString();
		const analysisInput = { code, price: item.price, lots, projection, probabilityUp: item.probabilityUp, ret5: item.ret5, ret20: item.ret20, news: item.news };
		const quota = config.ai.provider === "local" ? null : authService.consumeQuota(request.user);
		let explanation;
		try { explanation = await explainScenario(analysisInput, request.user?.id || ""); }
		catch (error) { explanation = { provider: "local-fallback", text: `${error.message}. Analisis lokal tetap digunakan.` }; }
		response.json({ id: `${Date.now()}-${code}`, createdAt: new Date().toISOString(), targetDate, code, name: item.name, lots, shares: lots * 100, entryPrice: item.price, tradingDays, horizon: projection.label, score: item.probabilityUp, backtestAccuracy: item.backtestAccuracy, news: item.news, explanation, quota, scenarios: { bear: { price: bearPrice, returnPercent: projection.lowReturn, pnl: calculate(bearPrice) }, expected: { price: projection.expectedPrice, returnPercent: projection.expectedReturn, pnl: calculate(projection.expectedPrice) }, bull: { price: bullPrice, returnPercent: projection.highReturn, pnl: calculate(bullPrice) } } });
	} catch (error) {
		response.status(400).json({ error: error.message });
	}
});

app.post("/api/select", async (request, response) => {
	try {
		const code = normalizeCode(request.body.code);
		const stock = catalog.find((item) => item.code === code);
		if (!stock) throw new Error(`${code} tidak ada di katalog KSEI`);
		state.selectedCode = code;
		state.selectedName = stock.name;
		state.status = `Memuat ${code}...`;
		state.market = null;
		broadcast();
		await refreshMarket();
		if (!state.market) throw new Error(state.error || `Harga ${code} tidak tersedia`);
		response.json({ ok: true, state: publicState() });
	} catch (error) {
		response.status(400).json({ ok: false, error: error.message });
	}
});

app.post("/api/trade", (request, response) => {
	try {
		if (!state.market?.price) throw new Error("Harga pasar belum tersedia");
		const action = String(request.body.action || "").toUpperCase();
		const lots = Number(request.body.lots);
		const order = { code: state.market.code, name: state.market.name, price: state.market.price, lots, reason: "MANUAL" };
		const paperTrader = traderFor(currentUser(request));
		if (action === "BUY") paperTrader.buy(order);
		else if (action === "SELL") paperTrader.sell(order);
		else throw new Error("Action harus BUY atau SELL");
		broadcast();
		response.json({ ok: true, paper: paperTrader.snapshot({ [order.code]: order.price }) });
	} catch (error) {
		response.status(400).json({ ok: false, error: error.message });
	}
});

app.post("/api/reset", (request, response) => {
	try {
		const paperTrader = traderFor(currentUser(request));
		const requestedBalance = request.body?.initialBalance;
		const initialBalance = requestedBalance === undefined ? paperTrader.initialBalance : Number(requestedBalance);
		const paper = paperTrader.reset(initialBalance);
		broadcast();
		response.json({ ok: true, paper });
	} catch (error) {
		response.status(400).json({ ok: false, error: error.message });
	}
});

app.get("*splat", (request, response) => response.sendFile(path.join(__dirname, "..", "public", "index.html")));

if (require.main === module) {
	server.listen(config.port, async () => {
		console.log(`IDX Local Simulator: http://localhost:${config.port}`);
		try {
			await ensureBootstrapped();
			console.log(`${catalog.length} saham dimuat; ${state.selectedCode} Rp${state.market?.price}`);
		} catch (error) {
			state.error = error.message;
			state.status = "Gagal memuat katalog saham";
			console.error(error.message);
			broadcast();
		}
	});
}

function shutdown() {
	clearInterval(refreshTimer);
	clearInterval(screenerTimer);
	browserSocket.close();
	server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

module.exports = app;
