function sigmoid(value) {
	return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

function mean(values) {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values, average) {
	return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1;
}

function featuresAt(closes, index) {
	const price = closes[index];
	const returns = [];
	for (let offset = 0; offset < 10; offset += 1) returns.push(closes[index - offset] / closes[index - offset - 1] - 1);
	const sma5 = mean(closes.slice(index - 4, index + 1));
	const sma20 = mean(closes.slice(index - 19, index + 1));
	const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
	const losses = -returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
	const rsi = losses === 0 ? 1 : 1 - 1 / (1 + gains / losses);
	return [
		returns[0],
		price / closes[index - 5] - 1,
		price / sma5 - 1,
		price / sma20 - 1,
		stdev(returns, mean(returns)),
		rsi - 0.5,
	];
}

function trainModel(candles) {
	const closes = candles.map((item) => item.adjustedClose || item.close).filter((value) => Number.isFinite(value) && value > 0);
	if (closes.length < 100) throw new Error("Histori belum cukup untuk melatih model AI");
	const rows = [];
	for (let index = 20; index < closes.length - 1; index += 1) {
		rows.push({ x: featuresAt(closes, index), y: closes[index + 1] > closes[index] ? 1 : 0 });
	}
	const split = Math.max(50, Math.floor(rows.length * 0.8));
	const train = rows.slice(0, split);
	const validation = rows.slice(split);
	const means = train[0].x.map((_, column) => mean(train.map((row) => row.x[column])));
	const deviations = means.map((average, column) => stdev(train.map((row) => row.x[column]), average));
	const normalize = (values) => values.map((value, column) => (value - means[column]) / deviations[column]);
	const normalizedTrain = train.map((row) => ({ x: normalize(row.x), y: row.y }));
	let weights = Array(normalizedTrain[0].x.length + 1).fill(0);
	const learningRate = 0.08;
	for (let epoch = 0; epoch < 450; epoch += 1) {
		const gradient = Array(weights.length).fill(0);
		for (const row of normalizedTrain) {
			const input = [1, ...row.x];
			const error = sigmoid(weights.reduce((sum, weight, i) => sum + weight * input[i], 0)) - row.y;
			input.forEach((value, i) => { gradient[i] += error * value; });
		}
		weights = weights.map((weight, i) => weight - learningRate * (gradient[i] / normalizedTrain.length + (i ? weight * 0.0005 : 0)));
	}
	const probabilityFor = (values) => {
		const input = [1, ...normalize(values)];
		return sigmoid(weights.reduce((sum, weight, i) => sum + weight * input[i], 0));
	};
	const correct = validation.filter((row) => (probabilityFor(row.x) >= 0.5 ? 1 : 0) === row.y).length;
	const probabilityUp = probabilityFor(featuresAt(closes, closes.length - 1));
	return {
		direction: probabilityUp >= 0.5 ? "NAIK" : "TURUN",
		probabilityUp: Number((probabilityUp * 100).toFixed(1)),
		confidence: Number((Math.max(probabilityUp, 1 - probabilityUp) * 100).toFixed(1)),
		backtestAccuracy: validation.length ? Number((correct / validation.length * 100).toFixed(1)) : null,
		trainingSamples: train.length,
		validationSamples: validation.length,
		horizon: "hari bursa berikutnya",
		model: "Logistic Regression (local)",
	};
}

module.exports = { trainModel };
