const fs = require("fs");
const path = require("path");
const config = require("../config");

class PaperTrader {
	constructor(options = {}) {
		this.file = path.resolve(options.file || config.paperFile);
		this.initialBalance = options.initialBalance || config.initialBalance;
		this.buyFeeRate = (options.buyFeePercent ?? config.buyFeePercent) / 100;
		this.sellFeeRate = (options.sellFeePercent ?? config.sellFeePercent) / 100;
		this.state = this.load();
		if (Number.isFinite(this.state.initialBalance)) this.initialBalance = this.state.initialBalance;
	}

	freshState() {
		return { version: 2, currency: "IDR", initialBalance: this.initialBalance, balance: this.initialBalance, positions: {}, realizedPnl: 0, trades: [], updatedAt: new Date().toISOString() };
	}

	load() {
		try {
			const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
			if (parsed.version === 2 && Number.isFinite(parsed.balance) && parsed.positions) return parsed;
			if (parsed.version === 1) {
				const backup = path.join(path.dirname(this.file), "paper-crypto-backup.json");
				if (!fs.existsSync(backup)) fs.copyFileSync(this.file, backup);
			}
		} catch {}
		return this.freshState();
	}

	save() {
		this.state.updatedAt = new Date().toISOString();
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		const temp = `${this.file}.tmp`;
		fs.writeFileSync(temp, JSON.stringify(this.state, null, 2));
		fs.renameSync(temp, this.file);
	}

	buy({ code, name, price, lots = 1, reason = "MANUAL" }) {
		this.validateOrder(code, price, lots);
		const shares = lots * 100;
		const gross = shares * price;
		const fee = gross * this.buyFeeRate;
		const total = gross + fee;
		if (total > this.state.balance) throw new Error(`Saldo tidak cukup. Dibutuhkan Rp${Math.ceil(total).toLocaleString("id-ID")}`);
		const current = this.state.positions[code];
		const position = current || { code, name, shares: 0, lots: 0, totalCost: 0, averagePrice: 0, lastPrice: price };
		position.shares += shares;
		position.lots = position.shares / 100;
		position.totalCost += total;
		position.averagePrice = position.totalCost / position.shares;
		position.lastPrice = price;
		position.updatedAt = new Date().toISOString();
		this.state.positions[code] = position;
		this.state.balance -= total;
		this.state.trades.unshift(this.tradeRecord("BUY", code, name, price, lots, shares, fee, 0, reason));
		this.trimAndSave();
		return this.snapshot({ [code]: price });
	}

	sell({ code, name, price, lots = 1, reason = "MANUAL" }) {
		this.validateOrder(code, price, lots);
		const position = this.state.positions[code];
		const shares = lots * 100;
		if (!position) throw new Error(`Tidak ada posisi ${code}`);
		if (shares > position.shares) throw new Error(`Posisi hanya ${position.lots} lot`);
		const gross = shares * price;
		const fee = gross * this.sellFeeRate;
		const allocatedCost = position.totalCost * (shares / position.shares);
		const proceeds = gross - fee;
		const pnl = proceeds - allocatedCost;
		this.state.balance += proceeds;
		this.state.realizedPnl += pnl;
		position.shares -= shares;
		position.lots = position.shares / 100;
		position.totalCost -= allocatedCost;
		position.averagePrice = position.shares ? position.totalCost / position.shares : 0;
		position.lastPrice = price;
		if (position.shares === 0) delete this.state.positions[code];
		this.state.trades.unshift(this.tradeRecord("SELL", code, name, price, lots, shares, fee, pnl, reason));
		this.trimAndSave();
		return this.snapshot({ [code]: price });
	}

	validateOrder(code, price, lots) {
		if (!code || !Number.isFinite(price) || price <= 0) throw new Error("Harga saham tidak valid");
		if (!Number.isInteger(lots) || lots < 1 || lots > 100000) throw new Error("Jumlah lot harus bilangan bulat positif");
	}

	tradeRecord(action, code, name, price, lots, shares, fee, pnl, reason) {
		return { id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, action, code, name, price, lots, shares, fee, pnl, reason, time: new Date().toISOString() };
	}

	trimAndSave() {
		this.state.trades = this.state.trades.slice(0, 500);
		this.save();
	}

	updatePrice(code, price) {
		if (this.state.positions[code] && Number.isFinite(price)) this.state.positions[code].lastPrice = price;
	}

	snapshot(prices = {}) {
		let marketValue = 0;
		let investedCost = 0;
		const positions = Object.values(this.state.positions).map((position) => {
			const price = prices[position.code] || position.lastPrice || position.averagePrice;
			const value = position.shares * price;
			const exitValue = value * (1 - this.sellFeeRate);
			const unrealizedPnl = exitValue - position.totalCost;
			marketValue += exitValue;
			investedCost += position.totalCost;
			return { ...position, price, marketValue: value, unrealizedPnl, pnlPercent: position.totalCost ? unrealizedPnl / position.totalCost * 100 : 0 };
		});
		return { ...this.state, positions, equity: this.state.balance + marketValue, marketValue, investedCost, unrealizedPnl: marketValue - investedCost, settings: { lotSize: 100, buyFeePercent: this.buyFeeRate * 100, sellFeePercent: this.sellFeeRate * 100 } };
	}

	reset(initialBalance = this.initialBalance) {
		if (!Number.isFinite(initialBalance) || initialBalance < 100000 || initialBalance > 1000000000000000) throw new Error("Saldo awal harus antara Rp100.000 dan Rp1.000.000.000.000.000");
		this.initialBalance = Math.round(initialBalance);
		this.state = this.freshState();
		this.save();
		return this.snapshot();
	}
}

module.exports = PaperTrader;
