const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { idx } = require("../config");

function decodeHtml(value) {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function parseCatalog(html) {
	const stocks = [];
	for (const row of html.matchAll(/<tr>[\s\S]*?<\/tr>/gi)) {
		const code = row[0].match(/shares\/lc\/([A-Z0-9.-]+)/i)?.[1]?.toUpperCase();
		if (!code) continue;
		const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
			.map((cell) => decodeHtml(cell[1].replace(/<[^>]+>/g, "")));
		stocks.push({ code, symbol: `${code}.JK`, name: cells[2] || code });
	}
	return stocks.sort((a, b) => a.code.localeCompare(b.code));
}

function readCache() {
	try {
		const cache = JSON.parse(fs.readFileSync(path.resolve(idx.catalogFile), "utf8"));
		return Array.isArray(cache.stocks) ? cache : null;
	} catch {
		return null;
	}
}

async function loadCatalog() {
	try {
		const response = await axios.get(idx.catalogUrl, {
			timeout: 20000,
			headers: { "User-Agent": "Mozilla/5.0 IDX Local Simulator" },
		});
		const stocks = parseCatalog(response.data);
		if (stocks.length < 500) throw new Error(`Katalog hanya berisi ${stocks.length} saham`);
		const result = { source: "KSEI", fetchedAt: new Date().toISOString(), stocks };
		const file = path.resolve(idx.catalogFile);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(result, null, 2));
		return result;
	} catch (error) {
		const cached = readCache();
		if (cached) return { ...cached, cached: true, error: error.message };
		throw error;
	}
}

module.exports = { loadCatalog, parseCatalog };
