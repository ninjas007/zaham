const config = require("../config");

function localExplanation(data) {
	const direction = data.projection.expectedReturn > 0 ? "naik" : data.projection.expectedReturn < 0 ? "turun" : "datar";
	return `Model lokal memperkirakan harga ${direction} pada horizon ${data.projection.label}. Dasarnya: momentum 5 hari ${data.ret5.toFixed(2)}%, momentum 1 bulan ${data.ret20.toFixed(2)}%, skor naik ${data.probabilityUp.toFixed(1)}, volatilitas historis, dan sentimen berita ${String(data.news?.label || "tidak tersedia").toLowerCase()}. Gunakan skenario turun sebagai batas risiko, bukan sebagai kepastian.`;
}

function responseText(body) {
	if (body.output_text) return body.output_text;
	return (body.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n").trim();
}

async function explainScenario(data, safetyIdentifier = "") {
	const apiKey = String(config.ai.apiKey || "");
	const model = String(config.ai.model || "");
	if (config.ai.provider === "local" || !apiKey || !model) return { provider: "local", text: localExplanation(data) };
	const input = `Jelaskan secara ringkas dalam Bahasa Indonesia simulasi saham berikut. Jangan menjanjikan keuntungan. Data: ${JSON.stringify(data)}`;
	const headers = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
	if (config.ai.provider === "openai") {
		const response = await fetch(`${config.ai.baseUrl}/responses`, { method: "POST", headers, body: JSON.stringify({ model, input, store: false, ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}) }), signal: AbortSignal.timeout(30000) });
		if (!response.ok) throw new Error(`OpenAI ${response.status}`);
		const body = await response.json();
		return { provider: `openai:${model}`, text: responseText(body) || localExplanation(data) };
	}
	const response = await fetch(`${config.ai.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model, messages: [{ role: "user", content: input }], temperature: 0.2 }), signal: AbortSignal.timeout(30000) });
	if (!response.ok) throw new Error(`Hermes ${response.status}`);
	const body = await response.json();
	return { provider: `hermes:${model}`, text: body.choices?.[0]?.message?.content || localExplanation(data) };
}

module.exports = { explainScenario, localExplanation, responseText };
