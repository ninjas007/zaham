const axios = require("axios");

const positiveWords = ["naik", "menguat", "melonjak", "tumbuh", "pertumbuhan", "laba", "untung", "dividen", "buyback", "ekspansi", "positif", "bullish", "rebound", "net buy", "akuisisi", "kontrak", "rekor", "upgrade", "borong", "membaik"];
const negativeWords = ["turun", "melemah", "anjlok", "merosot", "rugi", "kerugian", "koreksi", "suspensi", "gagal", "negatif", "bearish", "net sell", "tekanan", "utang", "gugatan", "fraud", "downgrade", "jual", "memburuk"];

function decode(value) {
	return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function textBetween(xml, tag) {
	return decode(xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]);
}

function scoreTitle(title) {
	const text = title.toLowerCase();
	let score = 0;
	for (const word of positiveWords) if (text.includes(word)) score += 1;
	for (const word of negativeWords) if (text.includes(word)) score -= 1;
	return Math.max(-3, Math.min(3, score));
}

async function getNewsSentiment(code, name, limit = 5) {
	const company = name.replace(/\b(pt|tbk|persero)\b[ .]*/gi, " ").trim().split(/\s+/).slice(0, 4).join(" ");
	const response = await axios.get("https://news.google.com/rss/search", {
		params: { q: `"${code}" saham ${company}`, hl: "id", gl: "ID", ceid: "ID:id" },
		timeout: 15000,
		headers: { "User-Agent": "Mozilla/5.0 IDX Local Simulator" },
	});
	const articles = [...String(response.data).matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, limit).map((match) => {
		const title = textBetween(match[1], "title");
		return { title, link: textBetween(match[1], "link"), publishedAt: textBetween(match[1], "pubDate"), source: textBetween(match[1], "source"), score: scoreTitle(title) };
	});
	const score = articles.length ? articles.reduce((sum, item) => sum + item.score, 0) / articles.length / 2 : 0;
	const normalized = Math.max(-1, Math.min(1, score));
	return { score: Number(normalized.toFixed(2)), label: normalized > 0.15 ? "POSITIF" : normalized < -0.15 ? "NEGATIF" : "NETRAL", articleCount: articles.length, articles };
}

module.exports = { getNewsSentiment, scoreTitle };
