const $ = (selector) => document.querySelector(selector);
const rupiah = (value, decimals = 0) => Number(value || 0).toLocaleString("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const number = (value, digits = 2) => Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: digits });
let latestState = null;
let stockPage = 1;
let stockPages = 1;
let searchTimer;
let activeRange = "1d";
let chartCandles = [];
let aiCode = null;
let historyRequest = 0;
let chartHover = null;
let renderedPoints = [];
let latestScreenerResult = null;
let allPickerStocks = [];
let selectedScreenerCodes = new Set();
let selectionInitialized = false;
let screenerPolling = false;
let activePlan = null;
const capitalStorageKey = "idx-paper-initial-balance";
const scenarioStorageKey = "idx-simulation-journal";
let simulationJournal = (() => { try { return JSON.parse(localStorage.getItem(scenarioStorageKey)) || []; } catch { return []; } })();
let authState = { authenticated: false, user: null, registrationEnabled: true };
let authMode = "login";

function setText(selector, value) { $(selector).textContent = value; }
function pnlClass(value) { return Number(value) >= 0 ? "positive" : "negative"; }

function renderChart(candles) {
	const canvas = $("#chart");
	const ratio = window.devicePixelRatio || 1;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	canvas.width = width * ratio;
	canvas.height = height * ratio;
	const context = canvas.getContext("2d");
	const theme = getComputedStyle(document.body);
	const themeText = theme.getPropertyValue("--text").trim() || "#f3f5f7";
	const themeMuted = theme.getPropertyValue("--muted").trim() || "#858d9b";
	const themeGreen = theme.getPropertyValue("--green").trim() || "#45d8a0";
	const lightTheme = document.body.classList.contains("light");
	context.scale(ratio, ratio);
	context.clearRect(0, 0, width, height);
	if (!candles?.length) return;
	const source = candles.length > 300 ? candles.filter((_, index) => index % Math.ceil(candles.length / 300) === 0) : candles;
	const values = source.map((item) => item.close);
	const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
	const area = { left: 14, right: width - 76, top: 18, bottom: height - 35 };
	const point = (value, index) => ({ x: area.left + index / Math.max(1, values.length - 1) * (area.right - area.left), y: area.top + (max - value) / range * (area.bottom - area.top) });

	context.font = "10px DM Mono";
	context.textBaseline = "middle";
	for (let tick = 0; tick <= 4; tick += 1) {
		const y = area.top + tick / 4 * (area.bottom - area.top);
		const value = max - tick / 4 * range;
		context.beginPath(); context.moveTo(area.left, y); context.lineTo(area.right, y);
		context.strokeStyle = lightTheme ? "rgba(40,70,55,.12)" : "rgba(133,141,155,.13)"; context.lineWidth = 1; context.stroke();
		context.fillStyle = themeMuted; context.textAlign = "left";
		context.fillText(compactRupiah(value), area.right + 9, y);
	}
	const dateFormatter = new Intl.DateTimeFormat("id-ID", activeRange === "1d" ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", year: activeRange === "5y" ? "2-digit" : undefined });
	for (let tick = 0; tick <= 4; tick += 1) {
		const index = Math.min(source.length - 1, Math.round(tick / 4 * (source.length - 1)));
		const x = point(source[index].close, index).x;
		context.fillStyle = themeMuted; context.textAlign = tick === 0 ? "left" : tick === 4 ? "right" : "center";
		context.fillText(dateFormatter.format(new Date(source[index].openTime)), x, height - 13);
	}
	const gradient = context.createLinearGradient(0, 0, 0, height);
	gradient.addColorStop(0, "rgba(68, 214, 157, .35)"); gradient.addColorStop(1, "rgba(68, 214, 157, 0)");
	context.beginPath(); values.forEach((value, index) => { const p = point(value, index); index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y); }); context.lineTo(area.right, area.bottom); context.lineTo(area.left, area.bottom); context.closePath(); context.fillStyle = gradient; context.fill();
	context.beginPath(); values.forEach((value, index) => { const p = point(value, index); index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y); }); context.strokeStyle = themeGreen; context.lineWidth = 2; context.stroke();
	renderedPoints = source.map((candle, index) => ({ ...point(candle.close, index), candle }));

	if (chartHover) {
		const hover = renderedPoints.reduce((nearest, current) => Math.abs(current.x - chartHover.x) < Math.abs(nearest.x - chartHover.x) ? current : nearest, renderedPoints[0]);
		context.setLineDash([4, 4]); context.strokeStyle = "rgba(210,218,225,.45)"; context.lineWidth = 1;
		context.beginPath(); context.moveTo(hover.x, area.top); context.lineTo(hover.x, area.bottom); context.moveTo(area.left, hover.y); context.lineTo(area.right, hover.y); context.stroke(); context.setLineDash([]);
		context.beginPath(); context.arc(hover.x, hover.y, 4, 0, Math.PI * 2); context.fillStyle = themeGreen; context.fill();
		const date = new Date(hover.candle.openTime).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: activeRange === "1d" || activeRange === "1m" ? "short" : undefined });
		const lines = [date, `Close ${rupiah(hover.candle.close)}`, `O ${number(hover.candle.open, 0)}  H ${number(hover.candle.high, 0)}  L ${number(hover.candle.low, 0)}`];
		const boxWidth = 205, boxHeight = 66;
		const boxX = Math.min(area.right - boxWidth - 5, Math.max(area.left + 5, hover.x + 12));
		const boxY = Math.min(area.bottom - boxHeight - 5, Math.max(area.top + 5, hover.y - boxHeight - 12));
		context.fillStyle = lightTheme ? "rgba(255,255,255,.97)" : "rgba(8,11,16,.96)"; context.strokeStyle = lightTheme ? "#c9d5cf" : "#35403d"; context.lineWidth = 1;
		context.beginPath(); context.roundRect(boxX, boxY, boxWidth, boxHeight, 8); context.fill(); context.stroke();
		context.textAlign = "left"; context.textBaseline = "top";
		lines.forEach((line, index) => { context.fillStyle = index === 1 ? themeGreen : index === 0 ? themeText : themeMuted; context.fillText(line, boxX + 10, boxY + 9 + index * 18); });
	}
}

function compactRupiah(value) {
	return `Rp${Number(value).toLocaleString("id-ID", { maximumFractionDigits: value < 100 ? 2 : 0 })}`;
}

function setTheme(theme) {
	document.body.classList.toggle("light", theme === "light");
	$("#theme-toggle").textContent = theme === "light" ? "Dark" : "Light";
	localStorage.setItem("idx-theme", theme);
	if (chartCandles.length) setTimeout(() => renderChart(chartCandles), 0);
}

function render(state) {
	const stockChanged = latestState?.selectedCode !== state.selectedCode;
	latestState = state;
	if (stockChanged) {
		activeRange = "1d";
		chartCandles = [];
		chartHover = null;
		document.querySelectorAll("[data-range]").forEach((button) => button.classList.toggle("active", button.dataset.range === "1d"));
	}
	const market = state.market;
	const paper = state.paper;
	setText("#stock-count", `${state.stockCount} emiten`);
	$("#connection").classList.toggle("online", state.connected);
	setText("#connection span", state.status);
	if (!market) return;
	const change = market.previousClose ? (market.price - market.previousClose) / market.previousClose * 100 : 0;
	setText("#stock-name", `${market.code} · ${market.name}`);
	setText("#price", rupiah(market.price));
	setText("#change", `${change >= 0 ? "+" : ""}${number(change)}%`);
	$("#change").className = `pill ${pnlClass(change)}`;
	setText("#updated", `Data pasar ${new Date(market.marketTime).toLocaleString("id-ID")} · ${market.delayMinutes ? `delayed ${market.delayMinutes} menit` : "live"}`);
	setText("#order-symbol", `Order ${market.code}`);
	setText("#quick-screener", `AI Screener ${market.code}`);

	const signal = state.prediction || {};
	$("#signal").className = `signal ${String(signal.signal).toLowerCase()}`;
	$("#signal strong").textContent = signal.signal;
	$("#signal span").textContent = `${signal.confidence}% confidence`;
	setText("#equity", rupiah(paper.equity));
	const totalPnl = paper.equity - paper.initialBalance;
	setText("#total-pnl", `${totalPnl >= 0 ? "+" : ""}${rupiah(totalPnl)} total P/L`);
	$("#total-pnl").className = pnlClass(totalPnl);
	setText("#balance", rupiah(paper.balance));
	if (!$("#initial-balance").dataset.ready) {
		const savedCapital = Number(localStorage.getItem(capitalStorageKey));
		$("#initial-balance").value = Number.isFinite(savedCapital) && savedCapital >= 100000 ? savedCapital : paper.initialBalance;
		$("#initial-balance").dataset.ready = "true";
	}
	setText("#capital-status", `Saldo aktif ${rupiah(paper.initialBalance)} · pengaturan tersimpan di browser`);
	setText("#portfolio-value", rupiah(paper.marketValue));
	setText("#position-count", `${paper.positions.length} posisi terbuka`);
	updateScenarioMarket(market, paper.settings);
	setText("#rsi", state.indicators.ready ? number(state.indicators.rsi) : "Menunggu");
	setText("#emas", state.indicators.ready ? `${rupiah(state.indicators.ema9)} / ${rupiah(state.indicators.ema21)}` : `${state.indicators.available || 0}/35 candle`);
	$("#reasons").innerHTML = (signal.reasons || []).map((reason) => `<li>${reason}</li>`).join("") || "<li>Menunggu data analisis</li>";
	$("#positions").innerHTML = paper.positions.map((position) => `<tr data-code="${position.code}"><td><b>${position.code}</b><small>${position.name}</small></td><td>${position.lots}</td><td>${rupiah(position.averagePrice)}</td><td>${rupiah(position.price)}</td><td>${rupiah(position.marketValue)}</td><td class="${pnlClass(position.unrealizedPnl)}">${position.unrealizedPnl >= 0 ? "+" : ""}${rupiah(position.unrealizedPnl)}<small>${number(position.pnlPercent)}%</small></td></tr>`).join("") || '<tr><td colspan="6" class="empty">Belum ada posisi. Pilih saham dan lakukan simulasi beli.</td></tr>';
	$("#trades").innerHTML = paper.trades.slice(0, 30).map((trade) => `<tr><td>${new Date(trade.time).toLocaleString("id-ID")}</td><td class="${trade.action === "BUY" ? "positive" : "negative"}">${trade.action}</td><td>${trade.code}</td><td>${trade.lots}</td><td>${rupiah(trade.price)}</td><td>${rupiah(trade.fee)}</td><td class="${pnlClass(trade.pnl)}">${trade.action === "SELL" ? `${trade.pnl >= 0 ? "+" : ""}${rupiah(trade.pnl)}` : "—"}</td></tr>`).join("") || '<tr><td colspan="7" class="empty">Belum ada transaksi</td></tr>';
	updateEstimate();
	if (activeRange === "1d") {
		chartCandles = market.candles;
		setText("#chart-title", `${market.code} · intraday 5 menit`);
		setText("#candle-count", `${market.candles.length} candle · 5 menit`);
		renderChart(chartCandles);
	}
	if (aiCode !== market.code) loadAI(market.code);
}

async function loadHistory(range) {
	if (!latestState?.market) return;
	activeRange = range;
	chartHover = null;
	document.querySelectorAll("[data-range]").forEach((button) => button.classList.toggle("active", button.dataset.range === range));
	if (range === "1d") {
		chartCandles = latestState.market.candles;
		setText("#chart-title", `${latestState.market.code} · intraday 5 menit`);
		setText("#candle-count", `${chartCandles.length} candle · 5 menit`);
		renderChart(chartCandles);
		return;
	}
	const requestId = ++historyRequest;
	const code = latestState.market.code;
	setText("#chart-title", `${code} · memuat histori...`);
	try {
		const response = await fetch(`/api/history/${code}?range=${range}`);
		const data = await response.json();
		if (!response.ok) throw new Error(data.error);
		if (requestId !== historyRequest || code !== latestState?.market?.code) return;
		chartCandles = data.candles;
		setText("#chart-title", `${code} · histori ${range.toUpperCase()}`);
		setText("#candle-count", `${data.candles.length} candle · ${data.interval}`);
		renderChart(chartCandles);
	} catch (error) { toast(error.message, true); }
}

async function loadAI(code) {
	aiCode = code;
	$("#ai-result").innerHTML = '<div class="ai-loader">Melatih model dari histori 5 tahun...</div>';
	try {
		const response = await fetch(`/api/ai/${code}`);
		const data = await response.json();
		if (!response.ok) throw new Error(data.error);
		if (aiCode !== code) return;
		const directionClass = data.direction === "NAIK" ? "positive" : "negative";
		$("#ai-result").innerHTML = `<div><span class="ai-direction ${directionClass}">${data.direction}</span><b>${data.confidence}% confidence</b><small>Peluang naik ${data.probabilityUp}%<br>Akurasi backtest ${data.backtestAccuracy}% · ${data.validationSamples} sampel<br>Horizon: ${data.horizon}</small></div>`;
	} catch (error) {
		if (aiCode === code) $("#ai-result").innerHTML = `<div class="ai-loader">${error.message}</div>`;
	}
}

async function loadStocks(page = 1) {
	const query = encodeURIComponent($("#search").value.trim());
	const response = await fetch(`/api/stocks?page=${page}&limit=50&search=${query}`);
	const data = await response.json();
	stockPage = data.page; stockPages = data.pages;
	setText("#page-info", `${stockPage} / ${stockPages}`);
	$("#prev").disabled = stockPage <= 1; $("#next").disabled = stockPage >= stockPages;
	$("#stock-list").innerHTML = data.stocks.map((stock) => `<button class="stock ${latestState?.selectedCode === stock.code ? "active" : ""}" data-code="${stock.code}"><b>${stock.code}</b><span>${stock.name}</span></button>`).join("") || '<p class="empty">Saham tidak ditemukan</p>';
}

async function selectStock(code) {
	try {
		$("#stock-list").classList.add("loading");
		const response = await fetch("/api/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
		const data = await response.json();
		if (!response.ok) throw new Error(data.error);
		render(data.state); loadStocks(stockPage);
	} catch (error) { toast(error.message, true); }
	finally { $("#stock-list").classList.remove("loading"); }
}

function updateEstimate() {
	if (!latestState?.market) return;
	const lots = Math.max(0, Number($("#lots").value) || 0);
	const gross = lots * 100 * latestState.market.price;
	setText("#estimate", `100 × ${lots} saham · estimasi ${rupiah(gross)}`);
	const held = latestState.paper.positions.find((item) => item.code === latestState.market.code)?.lots || 0;
	$("#buy").disabled = !Number.isInteger(lots) || lots < 1;
	$("#sell").disabled = !Number.isInteger(lots) || lots < 1 || lots > held;
}

async function trade(action) {
	try {
		const lots = Number($("#lots").value);
		const response = await fetch("/api/trade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, lots }) });
		const data = await response.json();
		if (!response.ok) { if (response.status === 401) openAuth(); throw new Error(data.error); }
		toast(`${action === "BUY" ? "Beli" : "Jual"} ${lots} lot ${latestState.selectedCode} berhasil`);
	} catch (error) { toast(error.message, true); }
}

async function resetVirtualAccount() {
	const initialBalance = Math.round(Number($("#initial-balance").value));
	if (!Number.isFinite(initialBalance) || initialBalance < 100000 || initialBalance > 1000000000000000) return toast("Saldo awal minimal Rp100.000", true);
	if (!confirm(`Reset akun virtual dengan saldo awal ${rupiah(initialBalance)}? Semua posisi dan transaksi akan dihapus.`)) return;
	try {
		const response = await fetch("/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initialBalance }) });
		const data = await response.json();
		if (!response.ok) { if (response.status === 401) openAuth(); throw new Error(data.error); }
		localStorage.setItem(capitalStorageKey, String(initialBalance));
		if (latestState) render({ ...latestState, paper: data.paper });
		toast(`Saldo virtual direset menjadi ${rupiah(initialBalance)}`);
	} catch (error) { toast(error.message, true); }
}

function saveSimulationJournal() {
	localStorage.setItem(scenarioStorageKey, JSON.stringify(simulationJournal.slice(0, 50)));
	renderSimulationJournal();
}

function updateScenarioMarket(market, settings) {
	let changed = false;
	simulationJournal.forEach((item) => {
		if (item.code !== market.code || item.actualPrice === market.price) return;
		item.actualPrice = market.price;
		item.actualAt = new Date().toISOString();
		item.actualPnl = Math.round(market.price * item.shares * (1 - Number(settings?.sellFeePercent || 0.25) / 100) - item.entryPrice * item.shares * (1 + Number(settings?.buyFeePercent || 0.15) / 100));
		changed = true;
	});
	if (changed) localStorage.setItem(scenarioStorageKey, JSON.stringify(simulationJournal.slice(0, 50)));
	renderSimulationJournal();
}

function scenarioBox(label, value, className = "") {
	return `<div><span>${label}</span><b class="${className}">${value}</b></div>`;
}

function renderSimulationJournal() {
	const container = $("#scenario-journal");
	if (!container) return;
	container.innerHTML = simulationJournal.map((item) => {
		const actual = Number.isFinite(item.actualPrice) ? `${rupiah(item.actualPrice)} · ${item.actualPnl >= 0 ? "+" : ""}${rupiah(item.actualPnl)}` : "Pilih saham ini untuk memperbarui";
		const due = Date.now() >= new Date(item.targetDate).getTime();
		const sources = (item.news?.articles || []).slice(0, 3).map((article) => `<a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>`).join("");
		return `<article class="scenario-item" data-scenario-id="${item.id}"><div class="scenario-heading"><div><b>${item.code} · ${item.horizon} · ${due ? "WAKTU EVALUASI" : "BERJALAN"}</b><small>${new Date(item.createdAt).toLocaleString("id-ID")} → evaluasi ${new Date(item.targetDate).toLocaleDateString("id-ID")}</small></div><button class="scenario-delete" title="Hapus">×</button></div><p>${item.lots} lot (${number(item.shares, 0)} saham) · beli acuan ${rupiah(item.entryPrice)} · skor ${number(item.score, 1)} · AI ${escapeHtml(item.explanation?.provider || "local")}</p><div class="scenario-outcomes">${scenarioBox("Jika turun", `${rupiah(item.scenarios.bear.price)} · ${item.scenarios.bear.pnl >= 0 ? "+" : ""}${rupiah(item.scenarios.bear.pnl)}`, pnlClass(item.scenarios.bear.pnl))}${scenarioBox("Estimasi utama", `${rupiah(item.scenarios.expected.price)} · ${item.scenarios.expected.pnl >= 0 ? "+" : ""}${rupiah(item.scenarios.expected.pnl)}`, pnlClass(item.scenarios.expected.pnl))}${scenarioBox("Jika naik", `${rupiah(item.scenarios.bull.price)} · ${item.scenarios.bull.pnl >= 0 ? "+" : ""}${rupiah(item.scenarios.bull.pnl)}`, pnlClass(item.scenarios.bull.pnl))}${scenarioBox("Harga aktual sekarang", actual, pnlClass(item.actualPnl || 0))}</div><p class="scenario-explanation">${escapeHtml(item.explanation?.text || "")}</p>${sources ? `<div class="scenario-sources"><span>Sumber informasi publik</span>${sources}</div>` : ""}</article>`;
	}).join("") || '<p class="empty">Belum ada simulasi tersimpan.</p>';
}

async function createScenario() {
	if (!latestState?.market) return;
	const lots = Math.floor(Number($("#lots").value));
	if (!Number.isInteger(lots) || lots < 1) return toast("Masukkan jumlah lot yang valid", true);
	const button = $("#create-scenario");
	button.disabled = true; button.textContent = "Menganalisis...";
	try {
		const response = await fetch("/api/scenario", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: latestState.market.code, lots, tradingDays: Number($("#scenario-horizon").value) }) });
		const data = await response.json();
		if (!response.ok) { if (response.status === 401) openAuth(); throw new Error(data.error); }
		simulationJournal.unshift(data);
		if (authState.user && data.quota) { authState.user.quota = data.quota; renderAuth(); }
		saveSimulationJournal();
		toast(`Simulasi ${data.code} ${data.horizon} tersimpan`);
	} catch (error) { toast(error.message, true); }
	finally { button.disabled = false; button.textContent = "Analisis & simpan simulasi"; }
}

function toast(message, error = false) { const element = $("#toast"); element.textContent = message; element.className = error ? "show error" : "show"; setTimeout(() => element.className = "", 3000); }

function renderAuth() {
	const user = authState.user;
	$("#account-button").textContent = user ? `${user.name} · ${user.quota.remaining}/${user.quota.limit}` : "Masuk";
	$("#auth-guest").classList.toggle("hidden", Boolean(user));
	$("#auth-user").classList.toggle("hidden", !user);
	$("#auth-register-tab").classList.toggle("hidden", !authState.registrationEnabled);
	if (user) {
		setText("#auth-title", "Akun saya"); setText("#auth-user-name", user.name); setText("#auth-user-email", user.email); setText("#auth-quota", `${user.quota.remaining} tersisa dari ${user.quota.limit}`);
	}
}

async function loadAuth() {
	try {
		const health = await fetch("/api/health").then((response) => response.json());
		const localAi = health.aiProvider === "local";
		$("#account-button").classList.toggle("hidden", localAi);
		if (localAi) return;
		authState = await fetch("/api/auth/me").then((response) => response.json());
		renderAuth();
	} catch {}
}

function setAuthMode(mode) {
	authMode = mode;
	const registering = mode === "register";
	$("#auth-name-wrap").classList.toggle("hidden", !registering);
	$("#auth-login-tab").classList.toggle("active", !registering);
	$("#auth-register-tab").classList.toggle("active", registering);
	$("#auth-password").autocomplete = registering ? "new-password" : "current-password";
	setText("#auth-title", registering ? "Daftar akun" : "Masuk"); setText("#auth-submit", registering ? "Daftar" : "Masuk"); setText("#auth-error", "");
}

function openAuth() { renderAuth(); $("#auth-modal").classList.remove("hidden"); }
function closeAuth() { $("#auth-modal").classList.add("hidden"); }

async function submitAuth(event) {
	event.preventDefault();
	const button = $("#auth-submit"); button.disabled = true;
	try {
		const response = await fetch(`/api/auth/${authMode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: $("#auth-name").value, email: $("#auth-email").value, password: $("#auth-password").value }) });
		const data = await response.json();
		if (!response.ok) throw new Error(data.error);
		authState = { ...authState, ...data }; renderAuth(); closeAuth(); toast(authMode === "register" ? "Akun berhasil dibuat" : "Berhasil masuk"); setTimeout(() => location.reload(), 350);
	} catch (error) { setText("#auth-error", error.message); }
	finally { button.disabled = false; }
}

function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function switchView(view) {
	document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
	$("#dashboard-view").classList.toggle("hidden", view !== "dashboard");
	$("#screener-view").classList.toggle("hidden", view !== "screener");
	if (view === "screener") {
		loadStockPicker();
		loadScreener();
	}
	else setTimeout(() => chartCandles.length && renderChart(chartCandles), 0);
}

async function loadStockPicker() {
	if (allPickerStocks.length) return renderStockPicker();
	try {
		const response = await fetch("/api/stocks?limit=1000");
		const data = await response.json();
		allPickerStocks = data.stocks || [];
		renderStockPicker();
	} catch (error) { toast(error.message, true); }
}

function renderStockPicker() {
	const query = $("#picker-search").value.trim().toLowerCase();
	const stocks = query
		? allPickerStocks.filter((stock) => `${stock.code} ${stock.name}`.toLowerCase().includes(query))
		: allPickerStocks;
	$("#picker-list").innerHTML = stocks.map((stock) => `<label class="picker-item"><input type="checkbox" value="${stock.code}" ${selectedScreenerCodes.has(stock.code) ? "checked" : ""}><span><b>${stock.code}</b><small>${escapeHtml(stock.name)}</small></span></label>`).join("") || '<p class="empty">Saham tidak ditemukan</p>';
	updateSelectionUI();
}

function updateSelectionUI(running = false) {
	setText("#selection-count", `${selectedScreenerCodes.size} dipilih`);
	$("#scan-all").disabled = running || selectedScreenerCodes.size === 0;
	if (!running) $("#scan-all").textContent = selectedScreenerCodes.size ? `Screener ${selectedScreenerCodes.size} saham` : "Pilih saham dahulu";
}

function projectionHtml(projections) {
	return projections.map((item) => `<button type="button" class="projection-row" data-plan-days="${item.tradingDays}" title="Klik untuk melihat rencana beli dan jual"><span><strong>${escapeHtml(item.label)}</strong><small>1 lot = 100 saham</small></span><b class="${pnlClass(item.profitPerLot)}">Est. bersih ${item.profitPerLot >= 0 ? "+" : ""}${rupiah(item.profitPerLot)}</b><span>Target ${rupiah(item.expectedPrice)}/saham · ${item.expectedReturn >= 0 ? "+" : ""}${number(item.expectedReturn)}%</span></button>`).join("");
}

function candidateHtml(item, direction) {
	const sentimentClass = item.news?.score > 0.15 ? "positive" : item.news?.score < -0.15 ? "negative" : "";
	const news = (item.news?.articles || []).slice(0, 2).map((article) => `<a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a>`).join("");
	const score = direction === "up" ? item.probabilityUp : 100 - item.probabilityUp;
	return `<div class="rank-item" data-code="${item.code}"><div class="rank-main"><div><b>${item.code}</b><small>${escapeHtml(item.name)}</small></div><span class="probability ${direction === "up" ? "positive" : "negative"}" title="Skor pemeringkatan, bukan peluang pasti">Skor ${number(score, 1)}</span></div><div class="rank-stats"><span>${rupiah(item.price)}</span><span>5D ${item.ret5 >= 0 ? "+" : ""}${number(item.ret5)}%</span><span>Uji ${number(item.backtestAccuracy, 1)}% · ${item.validationSamples || 0} hari</span><span class="sentiment ${sentimentClass}">Berita ${escapeHtml(item.news?.label || "—")}</span></div>${projectionHtml(item.projections || [])}<div class="news-links">${news || "<span class='muted'>Berita relevan tidak ditemukan</span>"}</div></div>`;
}

function roundIdxPrice(price) {
	const tick = price < 200 ? 1 : price < 500 ? 2 : price < 2000 ? 5 : price < 5000 ? 10 : 25;
	return Math.max(tick, Math.round(price / tick) * tick);
}

function calculatePlan(item, projection, requestedLots) {
	const settings = latestState?.paper?.settings || { buyFeePercent: 0.15, sellFeePercent: 0.25 };
	const balance = Number(latestState?.paper?.balance || 0);
	const equity = Number(latestState?.paper?.equity || balance);
	const entryPrice = Number(item.price);
	const targetPrice = Number(projection.expectedPrice);
	const adverseReturn = Math.min(-3, Number(projection.lowReturn) || -3);
	const stopPercent = Math.min(12, Math.max(3, Math.abs(adverseReturn)));
	const stopPrice = roundIdxPrice(entryPrice * (1 - stopPercent / 100));
	const buyFeeRate = Number(settings.buyFeePercent) / 100;
	const sellFeeRate = Number(settings.sellFeePercent) / 100;
	const capitalPerLot = entryPrice * 100 * (1 + buyFeeRate);
	const riskPerLot = Math.max(1, (entryPrice - stopPrice) * 100 + entryPrice * 100 * buyFeeRate + stopPrice * 100 * sellFeeRate);
	const lotsByCapital = Math.floor(balance * 0.1 / capitalPerLot);
	const lotsByRisk = Math.floor(equity * 0.01 / riskPerLot);
	const suggestedLots = projection.expectedReturn > 0 ? Math.max(0, Math.min(lotsByCapital, lotsByRisk)) : 0;
	const lots = Math.max(1, Math.floor(Number(requestedLots) || suggestedLots || 1));
	const grossBuy = entryPrice * 100 * lots;
	const buyFee = grossBuy * buyFeeRate;
	const grossSell = targetPrice * 100 * lots;
	const sellFee = grossSell * sellFeeRate;
	const estimatedProfit = grossSell - sellFee - grossBuy - buyFee;
	const stopProceeds = stopPrice * 100 * lots * (1 - sellFeeRate);
	const estimatedLoss = stopProceeds - grossBuy - buyFee;
	return { entryPrice, targetPrice, stopPrice, suggestedLots, lots, grossBuy, buyFee, sellFee, totalCapital: grossBuy + buyFee, estimatedProfit, estimatedLoss, balance };
}

function renderPlanCalculation() {
	if (!activePlan) return;
	const plan = calculatePlan(activePlan.item, activePlan.projection, $("#plan-lots").value);
	const affordable = plan.totalCapital <= plan.balance;
	$("#plan-calculation").innerHTML = `<div><span>Modal + fee beli</span><b>${rupiah(plan.totalCapital)}</b></div><div><span>Estimasi hasil bersih</span><b class="${pnlClass(plan.estimatedProfit)}">${plan.estimatedProfit >= 0 ? "+" : ""}${rupiah(plan.estimatedProfit)}</b></div><div><span>Risiko jika stop tersentuh</span><b class="negative">${rupiah(plan.estimatedLoss)}</b></div><div><span>Fee beli + estimasi fee jual</span><b>${rupiah(plan.buyFee + plan.sellFee)}</b></div>${affordable ? "" : '<p class="plan-warning">Saldo tunai tidak cukup untuk jumlah lot ini.</p>'}`;
	$("#plan-use-order").disabled = !affordable || plan.lots < 1 || activePlan.projection.expectedReturn <= 0;
}

function openPlan(item, projection) {
	activePlan = { item, projection };
	const initial = calculatePlan(item, projection);
	setText("#plan-title", `${item.code} · ${projection.label}`);
	const evidence = `Momentum 5 hari ${item.ret5 >= 0 ? "+" : ""}${number(item.ret5)}%, momentum 1 bulan ${item.ret20 >= 0 ? "+" : ""}${number(item.ret20)}%, berita ${String(item.news?.label || "tidak tersedia").toLowerCase()}, dan kecocokan uji historis ${number(item.backtestAccuracy, 1)}% dari ${item.validationSamples || 0} hari.`;
	setText("#plan-summary", projection.expectedReturn > 0
		? `Skenario naik dengan skor ${number(item.probabilityUp, 1)}. ${evidence} Saran ukuran posisi ${initial.suggestedLots || 0} lot berdasarkan saldo dan batas risiko.`
		: `Skenario saat ini belum mendukung pembelian. ${evidence} Saran 0 lot / tunggu sampai sinyal dan target kembali positif.`);
	$("#plan-levels").innerHTML = `<div><span>Harga beli acuan</span><b>${rupiah(initial.entryPrice)}</b><small>harga saat screener dijalankan</small></div><div><span>Target jual estimasi</span><b class="${pnlClass(projection.expectedReturn)}">${rupiah(initial.targetPrice)}</b><small>${projection.expectedReturn >= 0 ? "+" : ""}${number(projection.expectedReturn)}%</small></div><div><span>Stop risiko</span><b class="negative">${rupiah(initial.stopPrice)}</b><small>berdasarkan volatilitas historis</small></div><div><span>Rentang statistik</span><b>${number(projection.lowReturn)}% – ${number(projection.highReturn)}%</b><small>bukan batas harga pasti</small></div>`;
	$("#plan-lots").value = Math.max(1, initial.suggestedLots || 1);
	$("#plan-lots").disabled = false;
	$("#plan-use-order").textContent = projection.expectedReturn > 0 ? "Gunakan di simulasi order" : "Sinyal belum layak beli";
	$("#plan-use-order").disabled = projection.expectedReturn <= 0;
	renderPlanCalculation();
	$("#plan-modal").classList.remove("hidden");
}

function closePlan() {
	$("#plan-modal").classList.add("hidden");
	activePlan = null;
}

async function quickScreenerCurrentStock() {
	const code = latestState?.market?.code;
	if (!code) return;
	switchView("screener");
	await loadStockPicker();
	await getScreener();
	selectedScreenerCodes.add(code);
	$("#picker-search").value = code;
	renderStockPicker();
	$("#screener-view").scrollIntoView({ behavior: "smooth", block: "start" });
}

function matchesScreenerSearch(item, query) {
	if (!query) return true;
	const newsText = (item.news?.articles || []).map((article) => `${article.title} ${article.source}`).join(" ");
	return `${item.code} ${item.name} ${item.news?.label || ""} ${newsText}`.toLowerCase().includes(query);
}

function renderScreenerCandidates() {
	if (!latestScreenerResult) return;
	const query = $("#screener-search").value.trim().toLowerCase();
	const searchable = latestScreenerResult.all || [...latestScreenerResult.up, ...latestScreenerResult.down];
	const upSource = query ? searchable.filter((item) => item.probabilityUp >= 50) : latestScreenerResult.up;
	const downSource = query ? searchable.filter((item) => item.probabilityUp < 50) : latestScreenerResult.down;
	const up = upSource.filter((item) => matchesScreenerSearch(item, query)).slice(0, 50);
	const down = downSource.filter((item) => matchesScreenerSearch(item, query)).slice(0, 50);
	const skipped = query ? (latestScreenerResult.skipped || []).filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(query)) : [];
	$("#up-list").innerHTML = up.map((item) => candidateHtml(item, "up")).join("") || `<p class="empty">${query ? "Tidak ada kandidat naik yang cocok" : "Tidak ada kandidat naik"}</p>`;
	$("#down-list").innerHTML = down.map((item) => candidateHtml(item, "down")).join("") || `<p class="empty">${query ? "Tidak ada kandidat turun yang cocok" : "Tidak ada kandidat turun"}</p>`;
	setText("#screener-meta", query
		? `${up.length + down.length} hasil analisis untuk “${$("#screener-search").value.trim()}”${skipped.length ? ` · ${skipped.length} saham tidak lolos syarat data/likuiditas` : ""}`
		: `${latestScreenerResult.analyzed} saham likuid dianalisis dari ${latestScreenerResult.scanned} · ${latestScreenerResult.methodology} · ${new Date(latestScreenerResult.generatedAt).toLocaleString("id-ID")}`);
}

function renderScreener(screen) {
	if (!selectionInitialized) {
		selectedScreenerCodes = new Set(screen.selectedCodes || []);
		selectionInitialized = true;
		if (allPickerStocks.length) renderStockPicker();
	}
	const progress = screen.total ? Math.round(screen.completed / screen.total * 100) : 0;
	$("#scan-progress").classList.toggle("hidden", !screen.running);
	setText("#scan-percent", `${progress}%`);
	$("#scan-bar").style.width = `${progress}%`;
	setText("#scan-label", `Memindai ${screen.completed} dari ${screen.total} saham...`);
	updateSelectionUI(screen.running);
	if (screen.running) $("#scan-all").textContent = "Sedang memindai...";
	if (screen.error) toast(screen.error, true);
	if (!screen.result) return;
	const result = screen.result;
	latestScreenerResult = result;
	renderScreenerCandidates();
}

async function getScreener() {
	const response = await fetch("/api/screener");
	const screen = await response.json();
	renderScreener(screen);
	return screen;
}

async function startScreener() {
	try {
		if (!selectedScreenerCodes.size) return toast("Pilih minimal satu saham", true);
		const all = selectedScreenerCodes.size === allPickerStocks.length && allPickerStocks.length > 0;
		const response = await fetch("/api/screener/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(all ? { all: true } : { codes: [...selectedScreenerCodes] }) });
		const data = await response.json();
		if (!response.ok) throw new Error(data.error);
		pollScreenerUntilDone();
	} catch (error) { toast(error.message, true); }
}

async function pollScreenerUntilDone() {
	if (screenerPolling) return;
	screenerPolling = true;
	try {
		let screen;
		do {
			await new Promise((resolve) => setTimeout(resolve, 700));
			screen = await getScreener();
		} while (screen.running);
	} catch (error) { toast(error.message, true); }
	finally { screenerPolling = false; }
}

async function loadScreener() {
	try {
		const screen = await getScreener();
		if (screen.running) pollScreenerUntilDone();
	} catch (error) { toast(error.message, true); }
}

$("#stock-list").addEventListener("click", (event) => { const button = event.target.closest("[data-code]"); if (button) selectStock(button.dataset.code); });
$("#positions").addEventListener("click", (event) => { const row = event.target.closest("[data-code]"); if (row) selectStock(row.dataset.code); });
$("#search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadStocks(1), 250); });
$("#prev").addEventListener("click", () => loadStocks(stockPage - 1)); $("#next").addEventListener("click", () => loadStocks(stockPage + 1));
$("#lots").addEventListener("input", updateEstimate); $("#buy").addEventListener("click", () => trade("BUY")); $("#sell").addEventListener("click", () => trade("SELL"));
document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => loadHistory(button.dataset.range)));
$("#chart").addEventListener("pointermove", (event) => {
	const bounds = event.currentTarget.getBoundingClientRect();
	chartHover = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
	renderChart(chartCandles);
});
$("#chart").addEventListener("pointerleave", () => { chartHover = null; renderChart(chartCandles); });
$("#reset").addEventListener("click", resetVirtualAccount);
$("#apply-capital").addEventListener("click", resetVirtualAccount);
$("#create-scenario").addEventListener("click", createScenario);
$("#print-journal").addEventListener("click", () => window.print());
$("#scenario-journal").addEventListener("click", (event) => {
	const button = event.target.closest(".scenario-delete");
	if (!button) return;
	const id = button.closest("[data-scenario-id]")?.dataset.scenarioId;
	simulationJournal = simulationJournal.filter((item) => item.id !== id);
	saveSimulationJournal();
});
document.querySelectorAll(".nav-button[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#theme-toggle").addEventListener("click", () => setTheme(document.body.classList.contains("light") ? "dark" : "light"));
$("#account-button").addEventListener("click", openAuth);
$("#auth-login-tab").addEventListener("click", () => setAuthMode("login"));
$("#auth-register-tab").addEventListener("click", () => setAuthMode("register"));
$("#auth-form").addEventListener("submit", submitAuth);
$("#auth-modal").addEventListener("click", (event) => { if (event.target.closest("[data-close-auth]")) closeAuth(); });
$("#auth-logout").addEventListener("click", async () => { await fetch("/api/auth/logout", { method: "POST" }); authState = { ...authState, authenticated: false, user: null }; renderAuth(); closeAuth(); location.reload(); });
$("#quick-screener").addEventListener("click", quickScreenerCurrentStock);
$("#scan-all").addEventListener("click", startScreener);
$("#screener-search").addEventListener("input", renderScreenerCandidates);
$("#picker-search").addEventListener("input", renderStockPicker);
$("#picker-list").addEventListener("change", (event) => {
	const checkbox = event.target.closest('input[type="checkbox"]');
	if (!checkbox) return;
	if (checkbox.checked) selectedScreenerCodes.add(checkbox.value);
	else selectedScreenerCodes.delete(checkbox.value);
	updateSelectionUI();
});
$("#select-all-stocks").addEventListener("click", () => {
	selectedScreenerCodes = new Set(allPickerStocks.map((stock) => stock.code));
	renderStockPicker();
});
$("#clear-stocks").addEventListener("click", () => {
	selectedScreenerCodes.clear();
	renderStockPicker();
});
$("#screener-view").addEventListener("click", (event) => {
	if (event.target.closest("a")) return;
	const planButton = event.target.closest("[data-plan-days]");
	if (planButton) {
		const code = planButton.closest("[data-code]")?.dataset.code;
		const item = (latestScreenerResult?.all || []).find((row) => row.code === code);
		const projection = item?.projections?.find((row) => row.tradingDays === Number(planButton.dataset.planDays));
		if (item && projection) openPlan(item, projection);
		return;
	}
	const item = event.target.closest("[data-code]");
	if (item) { switchView("dashboard"); selectStock(item.dataset.code); }
});
$("#plan-lots").addEventListener("input", renderPlanCalculation);
$("#plan-modal").addEventListener("click", (event) => { if (event.target.closest("[data-close-plan]")) closePlan(); });
$("#plan-use-order").addEventListener("click", async () => {
	if (!activePlan) return;
	const code = activePlan.item.code;
	const lots = Math.max(1, Math.floor(Number($("#plan-lots").value) || 1));
	closePlan();
	await selectStock(code);
	$("#lots").value = lots;
	updateEstimate();
	switchView("dashboard");
	$(".trade-card").scrollIntoView({ behavior: "smooth", block: "center" });
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { if (!$("#plan-modal").classList.contains("hidden")) closePlan(); if (!$("#auth-modal").classList.contains("hidden")) closeAuth(); } });

function connect() { const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`); socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.type === "state") { render(message.data); if (!$("#stock-list .stock")) loadStocks(); } }; socket.onclose = () => setTimeout(connect, 2000); }
setTheme(localStorage.getItem("idx-theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
renderSimulationJournal();
fetch("/api/state").then((response) => response.json()).then((data) => { render(data); loadStocks(); }); connect();
loadAuth();
setInterval(() => {
	if (!$("#screener-view").classList.contains("hidden")) getScreener().catch(() => {});
}, 10000);
window.addEventListener("resize", () => chartCandles.length && renderChart(chartCandles));
