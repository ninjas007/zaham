const KSEI_SOURCE = "https://web.ksei.co.id/data/download-data-and-user-guide";
const CACHE_MS = 6 * 60 * 60 * 1000;
const caches = new Map();

function clean(value = "") { return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function parseDate(value) {
	const match = String(value).trim().match(/^(\d{2})-([A-Z]{3})-(\d{4})$/i);
	if (!match) return null;
	const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
	const month = months[match[2].toUpperCase()];
	return month === undefined ? null : new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
}
function displayDate(date) { return date ? new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date).replace(/\./g, "") : "—"; }

function parseSheet(html, code) {
	return [...html.matchAll(/<tr\s+id=isi[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => {
		const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => clean(cell[1]));
		const [_, issuer, securityCode, name, type, cum, record, payment, exerciseRatio, exerciseInstrument, proceedRatio] = cells;
		return { issuer, code: securityCode, name, type, cum: parseDate(cum), record: parseDate(record), pay: parseDate(payment), dps: Number(String(proceedRatio || "").replace(",", ".")), exerciseRatio, exerciseInstrument };
	}).filter((item) => item.type === "CASH DIVIDEND" && item.code === code && Number.isFinite(item.dps) && item.dps > 0)
		.map((item) => ({ code: item.code, name: item.name || item.issuer, dps: item.dps, cum: displayDate(item.cum), record: displayDate(item.record), pay: displayDate(item.pay), source: KSEI_SOURCE }));
}

module.exports = async (request, response) => {
	const code = String(request.query?.code || "").toUpperCase().trim();
	const year = Number(request.query?.year || new Date().getFullYear());
	if (!/^[A-Z]{2,6}$/.test(code)) return response.status(400).json({ error: "Masukkan kode saham IDX yang valid, misalnya BBCA." });
	if (!Number.isInteger(year) || year < 2001 || year > new Date().getFullYear()) return response.status(400).json({ error: "Tahun riwayat tidak valid." });
	const key = `${code}:${year}`;
	try {
		const cached = caches.get(key);
		if (cached && Date.now() - cached.time < CACHE_MS) return response.status(200).json({ ...cached.data, cached: true });
		const upstream = await fetch(`https://web.ksei.co.id/Download/div_${year}.xls`, { headers: { "user-agent": "DividenKi/1.0 (history reader)" }, signal: AbortSignal.timeout(20000) });
		if (!upstream.ok) throw new Error(`KSEI mengembalikan HTTP ${upstream.status}`);
		const data = { code, year, items: parseSheet(await upstream.text(), code), updatedAt: new Date().toISOString(), source: KSEI_SOURCE };
		caches.set(key, { time: Date.now(), data });
		response.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
		response.status(200).json(data);
	} catch (error) { response.status(502).json({ error: "Riwayat dividen KSEI sedang tidak dapat dimuat", detail: error.message }); }
};
