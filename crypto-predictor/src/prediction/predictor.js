function predict(indicators, candles) {
	if (!indicators?.ready || candles.length < 2) {
		return { signal: "HOLD", confidence: 0, score: 0, reasons: ["Data candle belum cukup"] };
	}

	let score = 0;
	const reasons = [];
	const current = candles[candles.length - 1].close;
	const previous = candles[candles.length - 2].close;

	if (indicators.ema9 > indicators.ema21) {
		score += 1;
		reasons.push("EMA 9 di atas EMA 21");
	} else {
		score -= 1;
		reasons.push("EMA 9 di bawah EMA 21");
	}

	if (indicators.rsi < 35) {
		score += 1;
		reasons.push("RSI mendekati oversold");
	} else if (indicators.rsi > 65) {
		score -= 1;
		reasons.push("RSI mendekati overbought");
	}

	if (indicators.macd?.histogram > 0) {
		score += 1;
		reasons.push("Momentum MACD positif");
	} else if (indicators.macd?.histogram < 0) {
		score -= 1;
		reasons.push("Momentum MACD negatif");
	}

	if (current > previous && current > indicators.sma20) score += 1;
	if (current < previous && current < indicators.sma20) score -= 1;

	const signal = score >= 2 ? "BUY" : score <= -2 ? "SELL" : "HOLD";
	return {
		signal,
		score,
		confidence: Math.min(95, 50 + Math.abs(score) * 10),
		reasons,
	};
}

module.exports = { predict };
