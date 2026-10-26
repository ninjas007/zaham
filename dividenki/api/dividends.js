const KSEI_DOWNLOAD = "https://web.ksei.co.id/Download/div_";
const KSEI_SOURCE = "https://web.ksei.co.id/data/download-data-and-user-guide";
const CACHE_MS = 6 * 60 * 60 * 1000;

let cache = null;

function clean(value = "") {
	return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function parseDate(value) {
	const match = String(value).trim().match(/^(\d{2})-([A-Z]{3})-(\d{4})$/i);
	if (!match) return null;
	const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
	const month = months[match[2].toUpperCase()];
	if (month === undefined) return null;
	return new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
}

function displayDate(date) {
	return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date).replace(/\./g, "");
}

function parseKseiSheet(html) {
	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);
	return [...html.matchAll(/<tr\s+id=isi[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => {
		const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => clean(cell[1]));
		const [_, issuer, code, name, type, cum, record, payment, exerciseRatio, exerciseInstrument, proceedRatio] = cells;
		const cumDate = parseDate(cum);
		const recordDate = parseDate(record);
		const paymentDate = parseDate(payment);
		const dps = Number(String(proceedRatio || "").replace(",", "."));
		return { code, name: name || issuer, type, cumDate, recordDate, paymentDate, dps, exerciseRatio, exerciseInstrument };
	}).filter((item) => item.type === "CASH DIVIDEND" && /^[A-Z]{2,6}$/.test(item.code) && item.recordDate && item.recordDate >= today && Number.isFinite(item.dps) && item.dps > 0)
		.map((item) => ({
			code: item.code,
			name: item.name,
			dps: item.dps,
			cum: item.cumDate ? displayDate(item.cumDate) : "—",
			ex: "Lihat sumber KSEI",
			record: displayDate(item.recordDate),
			pay: item.paymentDate ? displayDate(item.paymentDate) : "—",
			yield: null,
			soon: true,
			source: KSEI_SOURCE,
			sourceLabel: "KSEI",
		})).sort((a, b) => a.record.localeCompare(b.record));
}

module.exports = async (request, response) => {
	try {
		if (cache && Date.now() - cache.time < CACHE_MS) return response.status(200).json({ ...cache.data, cached: true });
		const year = new Date().getFullYear();
		const upstream = await fetch(`${KSEI_DOWNLOAD}${year}.xls`, { headers: { "user-agent": "DividenKi/1.0 (calendar reader)" }, signal: AbortSignal.timeout(20000) });
		if (!upstream.ok) throw new Error(`KSEI mengembalikan HTTP ${upstream.status}`);
		const html = await upstream.text();
		const data = { items: parseKseiSheet(html), updatedAt: new Date().toISOString(), source: KSEI_SOURCE };
		cache = { time: Date.now(), data };
		response.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
		response.status(200).json(data);
	} catch (error) {
		response.status(502).json({ error: "Data dividen KSEI sedang tidak dapat dimuat", detail: error.message });
	}
};
