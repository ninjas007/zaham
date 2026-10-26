const { RSI, EMA, SMA, MACD } = require("technicalindicators");

function last(values) {
	return values.length ? values[values.length - 1] : null;
}

function calculateIndicators(candles) {
	const closes = candles.map((item) => item.close).filter(Number.isFinite);
	if (closes.length < 35) {
		return { ready: false, required: 35, available: closes.length };
	}

	const rsi = last(RSI.calculate({ values: closes, period: 14 }));
	const ema9 = last(EMA.calculate({ values: closes, period: 9 }));
	const ema21 = last(EMA.calculate({ values: closes, period: 21 }));
	const sma20 = last(SMA.calculate({ values: closes, period: 20 }));
	const macd = last(MACD.calculate({
		values: closes,
		fastPeriod: 12,
		slowPeriod: 26,
		signalPeriod: 9,
		SimpleMAOscillator: false,
		SimpleMASignal: false,
	}));

	return {
		ready: true,
		rsi: Number(rsi.toFixed(2)),
		ema9: Number(ema9.toFixed(2)),
		ema21: Number(ema21.toFixed(2)),
		sma20: Number(sma20.toFixed(2)),
		macd: macd ? {
			value: Number((macd.MACD || 0).toFixed(2)),
			signal: Number((macd.signal || 0).toFixed(2)),
			histogram: Number((macd.histogram || 0).toFixed(2)),
		} : null,
	};
}

module.exports = { calculateIndicators };
