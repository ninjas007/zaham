const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const jakartaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

class AuthService {
	constructor({ file, dailyQuota = 10, sessionDays = 30 }) {
		this.file = path.resolve(file);
		this.dailyQuota = dailyQuota;
		this.sessionMs = sessionDays * 86400000;
		this.data = this.load();
	}

	load() {
		try {
			const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
			if (data.version === 1 && Array.isArray(data.users) && Array.isArray(data.sessions)) return data;
		} catch {}
		return { version: 1, users: [], sessions: [] };
	}

	save() {
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		const temp = `${this.file}.tmp`;
		fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
		fs.renameSync(temp, this.file);
	}

	hashPassword(password, salt) {
		return crypto.scryptSync(password, salt, 64).toString("hex");
	}

	validateInput({ name, email, password }, registering = false) {
		const normalizedEmail = String(email || "").trim().toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 160) throw new Error("Email tidak valid");
		if (typeof password !== "string" || password.length < 8 || password.length > 128) throw new Error("Password harus 8–128 karakter");
		const cleanName = String(name || "").trim();
		if (registering && (cleanName.length < 2 || cleanName.length > 60)) throw new Error("Nama harus 2–60 karakter");
		return { name: cleanName, email: normalizedEmail, password };
	}

	register(input) {
		const clean = this.validateInput(input, true);
		if (this.data.users.some((user) => user.email === clean.email)) throw new Error("Email sudah terdaftar");
		const salt = crypto.randomBytes(16).toString("hex");
		const user = { id: crypto.randomUUID(), name: clean.name, email: clean.email, salt, passwordHash: this.hashPassword(clean.password, salt), dailyQuota: this.dailyQuota, usageDate: jakartaDay(), usageCount: 0, createdAt: new Date().toISOString() };
		this.data.users.push(user);
		const session = this.createSession(user.id);
		this.save();
		return { token: session.token, user: this.publicUser(user) };
	}

	login(input) {
		const clean = this.validateInput(input, false);
		const user = this.data.users.find((item) => item.email === clean.email);
		const candidate = user ? this.hashPassword(clean.password, user.salt) : crypto.randomBytes(64).toString("hex");
		if (!user || !crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(user.passwordHash, "hex"))) throw new Error("Email atau password salah");
		const session = this.createSession(user.id);
		this.save();
		return { token: session.token, user: this.publicUser(user) };
	}

	createSession(userId) {
		const token = crypto.randomBytes(32).toString("base64url");
		this.data.sessions = this.data.sessions.filter((session) => new Date(session.expiresAt).getTime() > Date.now());
		this.data.sessions.push({ tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + this.sessionMs).toISOString() });
		return { token };
	}

	userFromToken(token) {
		if (!token) return null;
		const session = this.data.sessions.find((item) => item.tokenHash === sha256(token) && new Date(item.expiresAt).getTime() > Date.now());
		return session ? this.data.users.find((user) => user.id === session.userId) || null : null;
	}

	logout(token) {
		if (!token) return;
		this.data.sessions = this.data.sessions.filter((session) => session.tokenHash !== sha256(token));
		this.save();
	}

	refreshUsage(user) {
		const today = jakartaDay();
		if (user.usageDate !== today) { user.usageDate = today; user.usageCount = 0; }
	}

	publicUser(user) {
		this.refreshUsage(user);
		return { id: user.id, name: user.name, email: user.email, quota: { limit: user.dailyQuota, used: user.usageCount, remaining: Math.max(0, user.dailyQuota - user.usageCount), date: user.usageDate } };
	}

	consumeQuota(user) {
		this.refreshUsage(user);
		if (user.usageCount >= user.dailyQuota) throw new Error("Kuota analisis AI hari ini sudah habis");
		user.usageCount += 1;
		this.save();
		return this.publicUser(user).quota;
	}
}

module.exports = AuthService;
