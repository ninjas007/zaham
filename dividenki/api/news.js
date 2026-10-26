const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

function decode(value = "") { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, "").trim(); }
function field(xml, name) { return xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || ""; }

module.exports = async (request, response) => {
	const code = String(request.query?.code || "").toUpperCase().trim();
	if (!/^[A-Z]{2,6}$/.test(code)) return response.status(400).json({ error: "Kode saham tidak valid." });
	const cached = cache.get(code);
	if (cached && Date.now() - cached.time < CACHE_MS) return response.status(200).json({ ...cached.data, cached: true });
	try {
		const query = encodeURIComponent(`${code} dividen saham Indonesia`);
		const upstream = await fetch(`https://news.google.com/rss/search?q=${query}&hl=id&gl=ID&ceid=ID:id`, { headers: { "user-agent": "DividenKi/1.0" }, signal: AbortSignal.timeout(15000) });
		if (!upstream.ok) throw new Error(`Layanan berita mengembalikan HTTP ${upstream.status}`);
		const xml = await upstream.text();
		const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 5).map((match) => ({ title: decode(field(match[1], "title")), url: decode(field(match[1], "link")), publishedAt: decode(field(match[1], "pubDate")), source: decode(field(match[1], "source")) })).filter((item) => item.title && item.url);
		const data = { code, items, updatedAt: new Date().toISOString(), disclaimer: "Berita adalah konteks publik, bukan pengumuman resmi. Verifikasi jadwal pada KSEI/IDX/emiten." };
		cache.set(code, { time: Date.now(), data });
		response.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
		response.status(200).json(data);
	} catch (error) { response.status(502).json({ error: "Berita belum dapat dimuat", detail: error.message }); }
};
