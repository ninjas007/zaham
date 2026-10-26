const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

const smokePort = 3611;
const baseUrl = `http://127.0.0.1:${smokePort}`;
const smokePaperFile = path.join(os.tmpdir(), `idx-paper-smoke-${process.pid}.json`);
const smokeUsersFile = path.join(os.tmpdir(), `idx-users-smoke-${process.pid}.json`);
const child = spawn(process.execPath, ["src/server.js"], {
	cwd: process.cwd(),
	env: { ...process.env, PORT: String(smokePort), AUTO_TRADE: "false", PAPER_FILE: smokePaperFile, USERS_FILE: smokeUsersFile },
	stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let authCookie = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(path, options) {
	const requestOptions = { ...(options || {}), headers: { ...(options?.headers || {}), ...(authCookie ? { cookie: authCookie } : {}) } };
	const response = await fetch(`${baseUrl}${path}`, requestOptions);
	const setCookie = response.headers.get("set-cookie");
	if (setCookie) authCookie = setCookie.split(";")[0];
	const data = await response.json();
	if (!response.ok) throw new Error(data.error || `${response.status}`);
	return data;
}

async function waitForLive() {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		await wait(500);
		try {
			const state = await json("/api/state");
			if (state.connected && state.market?.price && state.stockCount > 500) return state;
		} catch {}
	}
	throw new Error(`Server/WebSocket tidak siap. Log: ${output}`);
}

async function main() {
	const live = await waitForLive();
	const search = await json("/api/stocks?search=telkom&limit=50");
	const selected = await json("/api/select", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code: "TLKM" }),
	});
	const historyMonth = await json("/api/history/TLKM?range=1m");
	const historyWeek = await json("/api/history/TLKM?range=1w");
	const historyFiveYears = await json("/api/history/TLKM?range=5y");
	const ai = await json("/api/ai/TLKM");
	const scenario = await json("/api/scenario", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "TLKM", lots: 100, tradingDays: 5 }) });
	const account = await json("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Smoke Test", email: `smoke-${Date.now()}@example.com`, password: "smoke-test-123" }) });
	const picker = await json("/api/stocks?limit=40");
	const selectedCodes = [...new Set([...picker.stocks.map((stock) => stock.code), "BBCA", "DMAS", "BUMI"] )];
	await json("/api/screener/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes: selectedCodes }) });
	let screener;
	for (let attempt = 0; attempt < 180; attempt += 1) {
		await wait(500);
		screener = await json("/api/screener");
		if (!screener.running) break;
	}
	if (!screener?.result) throw new Error(screener?.error || "Screener tidak selesai");
	const displayedCandidates = [...screener.result.up, ...screener.result.down];
	if (new Set(displayedCandidates.map((item) => item.code)).size !== displayedCandidates.length) throw new Error("Kandidat screener masih duplikat");
	if (displayedCandidates.some((item) => item.probabilityUp < 38 || item.probabilityUp > 62)) throw new Error("Skor screener tidak terkalibrasi");
	const configuredReset = await json("/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initialBalance: 125000000 }) });
	const buy = await json("/api/trade", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action: "BUY", lots: 1 }),
	});
	const sell = await json("/api/trade", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action: "SELL", lots: 1 }),
	});
	const reset = await json("/api/reset", { method: "POST" });

	console.log(JSON.stringify({
		serverOk: true,
		marketConnected: live.connected,
		provider: live.provider,
		catalogSource: live.catalogSource,
		stockCount: live.stockCount,
		searchWorks: search.stocks.some((stock) => stock.code === "TLKM"),
		selected: selected.state.market.code,
		marketPrice: selected.state.market.price,
		delayMinutes: selected.state.market.delayMinutes,
		candleCount: selected.state.market.candles.length,
		historyMonth: historyMonth.candles.length,
		historyWeek: historyWeek.candles.length,
		historyFiveYears: historyFiveYears.candles.length,
		aiDirection: ai.direction,
		aiProbabilityUp: ai.probabilityUp,
		aiBacktestAccuracy: ai.backtestAccuracy,
		accountAuthenticated: account.authenticated,
		accountQuotaRemaining: scenario.quota?.remaining ?? "tidak dipakai (local)",
		scenarioHorizon: scenario.horizon,
		scenarioProvider: scenario.explanation.provider,
		scenarioHasThreeOutcomes: [scenario.scenarios.bear, scenario.scenarios.expected, scenario.scenarios.bull].every((item) => Number.isFinite(item.pnl)),
		screenerAnalyzed: screener.result.analyzed,
		screenerRequested: selectedCodes.length,
		screenerScanned: screener.result.scanned,
		selectionRespected: screener.result.scanned === selectedCodes.length,
		requestedStocksDetected: ["BBCA", "DMAS", "BUMI"].every((code) => screener.result.all.some((item) => item.code === code) || screener.result.skipped.some((item) => item.code === code)),
		requestedStocksAnalyzed: ["BBCA", "DMAS", "BUMI"].filter((code) => screener.result.all.some((item) => item.code === code)),
		upCandidates: screener.result.up.length,
		downCandidates: screener.result.down.length,
		newsIncluded: [...screener.result.up, ...screener.result.down].some((item) => item.news?.articleCount > 0),
		candidatesUnique: new Set(displayedCandidates.map((item) => item.code)).size === displayedCandidates.length,
		maximumRankingScore: Math.max(...displayedCandidates.map((item) => Math.max(item.probabilityUp, 100 - item.probabilityUp))),
		customInitialBalance: configuredReset.paper.initialBalance,
		buyCreated: buy.paper.positions.length === 1,
		sellClosed: sell.paper.positions.length === 0,
		tradeRecorded: sell.paper.trades.length === 2,
		resetBalance: reset.paper.balance,
	}, null, 2));
}

main()
	.catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	})
	.finally(() => child.kill("SIGTERM"));
