require("dotenv").config();

function numberFromEnv(name, fallback) {
	const value = Number(process.env[name]);
	return Number.isFinite(value) ? value : fallback;
}

function booleanFromEnv(name, fallback) {
	if (process.env[name] === undefined) return fallback;
	return ["1", "true", "yes", "on"].includes(process.env[name].toLowerCase());
}

module.exports = {
	port: numberFromEnv("PORT", 3600),

	idx: {
		catalogUrl: process.env.IDX_CATALOG_URL || "https://web.ksei.co.id/services/registered-securities/shares?setLocale=id-ID",
		marketUrl: process.env.IDX_MARKET_URL || "https://query1.finance.yahoo.com/v8/finance/chart",
		refreshMs: Math.max(10000, numberFromEnv("MARKET_REFRESH_MS", 15000)),
		screenerRefreshMs: Math.max(5 * 60 * 1000, numberFromEnv("SCREENER_REFRESH_MS", 15 * 60 * 1000)),
		catalogFile: process.env.STOCK_CATALOG_FILE || "data/stocks.json",
	},

	symbol: String(process.env.SYMBOL || "BBCA").toUpperCase().replace(/\.JK$/, ""),
	candleLimit: Math.min(500, Math.max(50, numberFromEnv("CANDLE_LIMIT", 240))),

	initialBalance: numberFromEnv("INITIAL_BALANCE", 100000000),
	buyFeePercent: Math.max(0, numberFromEnv("BUY_FEE_PERCENT", 0.15)),
	sellFeePercent: Math.max(0, numberFromEnv("SELL_FEE_PERCENT", 0.25)),
	autoTrade: booleanFromEnv("AUTO_TRADE", false),
	paperFile: process.env.PAPER_FILE || "data/paper.json",
	ai: {
		provider: String(process.env.AI_PROVIDER || "local").toLowerCase(),
		model: process.env.AI_MODEL || "",
		apiKey: process.env.AI_API_KEY || "",
		baseUrl: String(process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
		dailyQuota: Math.max(1, Math.min(1000, numberFromEnv("AI_DAILY_QUOTA", 10))),
	},
	auth: {
		usersFile: process.env.USERS_FILE || "data/users.json",
		sessionDays: Math.max(1, Math.min(365, numberFromEnv("SESSION_DAYS", 30))),
		allowRegistration: booleanFromEnv("ALLOW_REGISTRATION", true),
		secureCookie: booleanFromEnv("SECURE_COOKIE", process.env.NODE_ENV === "production"),
	},
};
