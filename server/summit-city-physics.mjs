//#region src/citydata.ts
function e(e) {
	if (e.enc === 1) {
		for (let t of e.buildings) t.p = r(t.p, 2, 10);
		e.trees = r(e.trees, 2, 10), e.parked = r(e.parked, 4, 100);
	}
	return e;
}
var t = null;
function n(e, n) {
	return a(t, e, n);
}
function r(e, t, n) {
	let r = Array(e.length), i = Array(t).fill(0);
	for (let a = 0; a < e.length; a++) i[a % t] += e[a], r[a] = i[a % t] / n;
	return r;
}
function i(e) {
	if (e.buildings ??= [], e.trees ??= [], e.enc !== 1) return e;
	for (let t of e.buildings) t.p = r(t.p, 2, 10);
	for (let t of e.greens) t.p = r(t.p, 2, 10);
	e.trees = r(e.trees, 2, 10), e.net.nodes = r(e.net.nodes, 2, 10);
	for (let t of e.net.ways) t.n = r(t.n, 1, 1);
	e.net.y && (e.net.y = r(e.net.y, 1, 10)), e.ground && (e.ground.h = r(e.ground.h, 1, 2)), t = e.terrain ?? null, e.net.decks = e.net.ways.filter((e) => e.e), e.net.ways = e.net.ways.filter((e) => !e.e), e.lamps &&= r(e.lamps, 3, 100), e.parked &&= r(e.parked, 4, 100), e.terrain && (e.terrain.h = r(e.terrain.h, 1, 2));
	for (let t of e.trails ?? []) t.p = r(t.p, 2, 10);
	for (let t of e.elevated ?? []) t.p = r(t.p, 2, 10), t.y = r(t.y, 1, 10);
	for (let t of e.water ?? []) t.p = r(t.p, 2, 10);
	e.market &&= e.market.map((e) => r(e, 2, 10));
	for (let t of e.pedzones ?? []) t.p = r(t.p, 2, 10);
	return e.roads ??= [], delete e.enc, e;
}
function a(e, t, n) {
	if (!e) return 0;
	let r = (t - e.x0) / e.step, i = (n - e.z0) / e.step, a = Math.floor(r), o = Math.floor(i);
	if (a < 0 || o < 0 || a >= e.nx - 1 || o >= e.nz - 1) return 0;
	let s = r - a, c = i - o, l = e.h, u = e.nx;
	return (l[o * u + a] * (1 - s) + l[o * u + a + 1] * s) * (1 - c) + (l[(o + 1) * u + a] * (1 - s) + l[(o + 1) * u + a + 1] * s) * c;
}
var o = class {
	size;
	cells = /* @__PURE__ */ new Map();
	constructor(e) {
		this.size = e;
	}
	key(e, t) {
		return (e + 4096) * 8192 + (t + 4096);
	}
	addBox(e, t, n, r, i) {
		let a = this.size;
		for (let o = Math.floor(Math.min(e, n) / a); o <= Math.floor(Math.max(e, n) / a); o++) for (let e = Math.floor(Math.min(t, r) / a); e <= Math.floor(Math.max(t, r) / a); e++) {
			let t = this.key(o, e), n = this.cells.get(t);
			n || this.cells.set(t, n = []), n.push(i);
		}
	}
	query(e, t, n, r = []) {
		r.length = 0;
		let i = this.size;
		for (let a = Math.floor((e - n) / i); a <= Math.floor((e + n) / i); a++) for (let e = Math.floor((t - n) / i); e <= Math.floor((t + n) / i); e++) {
			let t = this.cells.get(this.key(a, e));
			if (t) for (let e of t) r.push(e);
		}
		return r;
	}
	removeIf(e, t, n, r, i) {
		let a = this.size;
		for (let o = Math.floor(e / a); o <= Math.floor(n / a); o++) for (let e = Math.floor(t / a); e <= Math.floor(r / a); e++) {
			let t = this.key(o, e), n = this.cells.get(t);
			if (!n) continue;
			let r = n.filter((e) => !i(e));
			r.length ? this.cells.set(t, r) : this.cells.delete(t);
		}
	}
}, s = class {
	edges = new o(16);
	posts = new o(16);
	te = [];
	tp = [];
	terrain;
	groundAt = () => 0;
	constructor(e) {
		this.terrain = e.terrain ?? null, this.addBuildings(e.buildings);
	}
	addBuildings(e, t) {
		let n = [
			Infinity,
			Infinity,
			-Infinity,
			-Infinity
		];
		for (let r of e) {
			if ((r.m ?? 0) > 2) continue;
			let e = r.p, i = e.length / 2;
			for (let r = 0; r < i; r++) {
				let a = (r + 1) % i, o = {
					x1: e[r * 2],
					z1: e[r * 2 + 1],
					x2: e[a * 2],
					z2: e[a * 2 + 1],
					tag: t
				};
				this.edges.addBox(o.x1, o.z1, o.x2, o.z2, o), n[0] = Math.min(n[0], o.x1), n[1] = Math.min(n[1], o.z1), n[2] = Math.max(n[2], o.x1), n[3] = Math.max(n[3], o.z1);
			}
		}
		return n;
	}
	addEdges(e, t) {
		for (let n = 0; n + 3 < e.length; n += 4) {
			let r = {
				x1: e[n],
				z1: e[n + 1],
				x2: e[n + 2],
				z2: e[n + 3],
				tag: t
			};
			this.edges.addBox(r.x1, r.z1, r.x2, r.z2, r);
		}
	}
	removeTag(e, t) {
		t[0] <= t[2] && this.edges.removeIf(t[0], t[1], t[2], t[3], (t) => t.tag === e);
	}
	addPost(e, t, n, r, i) {
		this.posts.addBox(e, t, e, t, {
			x: e,
			z: t,
			r: n,
			y1: r,
			y2: i
		});
	}
	addWall(e, t, n, r, i, a) {
		this.edges.addBox(e, t, n, r, {
			x1: e,
			z1: t,
			x2: n,
			z2: r,
			y1: i,
			y2: a
		});
	}
	addRect(e, t, n, r) {
		let i = e - n / 2, a = t - r / 2, o = e + n / 2, s = t + r / 2;
		for (let [e, t, n, r] of [
			[
				i,
				a,
				o,
				a
			],
			[
				o,
				a,
				o,
				s
			],
			[
				o,
				s,
				i,
				s
			],
			[
				i,
				s,
				i,
				a
			]
		]) this.edges.addBox(e, t, n, r, {
			x1: e,
			z1: t,
			x2: n,
			z2: r
		});
	}
	contacts(e, t, n, r, i = -.25) {
		r.length = 0;
		let o = this.groundAt(e, t), s = o + 3, c = o - 1.1, l = i < s && i > c, u = (e) => e.y1 === void 0 ? l : i + 1.6 >= e.y1 && i + .2 <= e.y2;
		for (let i of this.edges.query(e, t, n, this.te)) {
			if (!u(i)) continue;
			let a = i.x2 - i.x1, o = i.z2 - i.z1, s = a * a + o * o || 1, c = Math.max(0, Math.min(1, ((e - i.x1) * a + (t - i.z1) * o) / s)), l = e - i.x1 - a * c, d = t - i.z1 - o * c, f = Math.hypot(l, d);
			f < n && f > 1e-4 && r.push({
				nx: l / f,
				nz: d / f,
				depth: n - f
			});
		}
		for (let i of this.posts.query(e, t, n + .5, this.tp)) {
			if (!u(i)) continue;
			let a = e - i.x, o = t - i.z, s = Math.hypot(a, o), c = n + i.r;
			s < c && s > 1e-4 && r.push({
				nx: a / s,
				nz: o / s,
				depth: c - s
			});
		}
		if (this.terrain && l) {
			let n = a(this.terrain, e + 2, t) - a(this.terrain, e - 2, t), i = a(this.terrain, e, t + 2) - a(this.terrain, e, t - 2), o = Math.hypot(n, i) / 4;
			if (o > .45) {
				let e = Math.hypot(n, i) || 1;
				r.push({
					nx: -n / e,
					nz: -i / e,
					depth: Math.min(.5, (o - .45) * 1.5)
				});
			}
		}
		if (r.length > 1) {
			r.sort((e, t) => t.depth - e.depth);
			let e = [];
			for (let t of r) e.some((e) => e.nx * t.nx + e.nz * t.nz > .95) || e.push(t);
			r.length = 0, r.push(...e);
		}
		return r;
	}
	push(e, t, n, r) {
		r[0] = 0, r[1] = 0;
		let i = !1;
		for (let a of this.edges.query(e, t, n, this.te)) {
			if (a.y1 !== void 0 && a.y1 > 2) continue;
			let o = a.x2 - a.x1, s = a.z2 - a.z1, c = o * o + s * s || 1, l = Math.max(0, Math.min(1, ((e - a.x1) * o + (t - a.z1) * s) / c)), u = a.x1 + o * l, d = a.z1 + s * l, f = e - u, p = t - d, m = Math.hypot(f, p);
			m < n && m > 1e-4 && (r[0] += f / m * (n - m), r[1] += p / m * (n - m), i = !0);
		}
		for (let a of this.posts.query(e, t, n + .5, this.tp)) {
			let o = e - a.x, s = t - a.z, c = Math.hypot(o, s), l = n + a.r;
			c < l && c > 1e-4 && (r[0] += o / c * (l - c), r[1] += s / c * (l - c), i = !0);
		}
		return i;
	}
}, c = -.25, l = class {
	ground;
	grid = new o(20);
	tmp = [];
	segs = [];
	rails = [];
	followGround = !0;
	tunnels = !1;
	constructor(e) {
		this.ground = e.terrain ?? null;
		let t = e.net.nodes, n = e.net.y ?? [];
		for (let r of e.net.decks ?? []) for (let e = 0; e + 1 < r.n.length; e++) {
			let i = r.n[e], a = r.n[e + 1], o = t[i * 2], s = t[i * 2 + 1], l = t[a * 2], u = t[a * 2 + 1], d = Math.hypot(l - o, u - s);
			if (d < .2) continue;
			let f = {
				ax: o,
				az: s,
				bx: l,
				bz: u,
				ya: (n[i] ?? 0) + c,
				yb: (n[a] ?? 0) + c,
				hw: r.w / 2,
				ux: (l - o) / d,
				uz: (u - s) / d,
				len: d,
				way: r
			};
			this.segs.push(f), this.grid.addBox(Math.min(o, l) - f.hw, Math.min(s, u) - f.hw, Math.max(o, l) + f.hw, Math.max(s, u) + f.hw, f);
		}
		this.buildRails();
	}
	groundY(e, t) {
		return (this.followGround ? a(this.ground, e, t) : 0) + c;
	}
	groundAt(e, t) {
		return this.followGround ? a(this.ground, e, t) : 0;
	}
	usable(e) {
		return e.way.e === 1 || this.tunnels;
	}
	onSeg(e, t, n, r) {
		let i = ((t - e.ax) * e.ux + (n - e.az) * e.uz) / e.len;
		if (i < -.02 || i > 1.02) return null;
		let a = Math.max(0, Math.min(1, i)), o = e.ax + (e.bx - e.ax) * a, s = e.az + (e.bz - e.az) * a;
		return Math.hypot(t - o, n - s) > e.hw + r ? null : e.ya + (e.yb - e.ya) * a;
	}
	at(e, t, n, r = {
		y: 0,
		seg: null
	}) {
		let i = n + .6, a = this.groundY(e, t), o = a <= i ? a : -Infinity, s = null, c = null, l = 0;
		for (let r of this.grid.query(e, t, 1, this.tmp)) {
			if (!this.usable(r)) continue;
			let a = this.onSeg(r, e, t, .3);
			a != null && (a <= i && a > o && (o = a, s = r), r.way.e === 2 && Math.abs(a - n) < .8 && (!c || Math.abs(a - n) < Math.abs(l - n)) && (c = r, l = a));
		}
		return c && l < o && (o = l, s = c), r.y = o > -Infinity ? o : a, r.seg = o > -Infinity ? s : null, r;
	}
	deckBelow(e, t, n, r = .8) {
		for (let i of this.grid.query(e, t, r + 1, this.tmp)) {
			let a = this.onSeg(i, e, t, r);
			if (a != null && a < n - 1) return !0;
		}
		return !1;
	}
	nearestDeck(e, t, n, r = 40) {
		let i = null, a = Infinity;
		for (let o of this.grid.query(e, t, r, this.tmp)) {
			if (!this.usable(o)) continue;
			let r = Math.max(0, Math.min(1, ((e - o.ax) * o.ux + (t - o.az) * o.uz) / o.len)), s = o.ya + (o.yb - o.ya) * r, c = Math.hypot(e - o.ax - (o.bx - o.ax) * r, t - o.az - (o.bz - o.az) * r) + Math.abs(s - n) * 3;
			c < a && (a = c, i = o);
		}
		return i;
	}
	buildRails() {
		for (let e of this.segs) for (let t of [-1, 1]) {
			let n = -e.uz * t * e.hw, r = e.ux * t * e.hw, i = [], a = () => {
				if (i.length >= 2) {
					let t = i[0], n = i[i.length - 1];
					this.rails.push({
						x1: t.x,
						z1: t.z,
						x2: n.x,
						z2: n.z,
						ya: t.y,
						yb: n.y,
						y1: Math.min(t.y, n.y) - .3,
						y2: Math.max(t.y, n.y) + 1.2,
						e: e.way.e === 2 ? 2 : 1,
						way: e.way
					});
				}
				i = [];
			}, o = Math.max(1, Math.round(e.len / 3));
			for (let t = 0; t <= o; t++) {
				let s = t / o, c = e.ax + (e.bx - e.ax) * s + n, l = e.az + (e.bz - e.az) * s + r, u = e.ya + (e.yb - e.ya) * s, d = e.way.e === 1 && u - this.groundY(c, l) < .6;
				if (!d) for (let t of this.grid.query(c, l, 1, this.tmp)) {
					if (t.way === e.way) continue;
					let n = this.onSeg(t, c, l, -.4);
					if (n != null && n > u - 2.2 && n < u + 1.5) {
						d = !0;
						break;
					}
				}
				if (d ? a() : i.push({
					x: c,
					z: l,
					y: u
				}), i.length >= 5) {
					let e = i[i.length - 1];
					a(), i.push(e);
				}
			}
			a();
		}
	}
}, u = 8.5, d = 16, f = 2.7, p = 13.5, m = 2.2, h = .95, g = [
	1.45,
	0,
	-1.45
], _ = {
	engine: u,
	vmax: 46,
	brake: d,
	grip: p,
	mass: 1
}, v = class e {
	x = 0;
	z = 0;
	h = 0;
	vx = 0;
	vz = 0;
	w = 0;
	steer = 0;
	spec = _;
	geometry;
	drift = !1;
	y = -.25;
	vy = 0;
	pitch = 0;
	roll = 0;
	landed = 0;
	touch = !1;
	static surface = null;
	sh = {
		y: 0,
		seg: null
	};
	hitCool = 0;
	contacts = [];
	get slip() {
		let e = Math.hypot(this.vx, this.vz);
		if (e < 1) return 0;
		let t = Math.sin(this.h), n = Math.cos(this.h);
		return Math.acos(Math.max(-1, Math.min(1, Math.abs(this.vx * t + this.vz * n) / e)));
	}
	get v() {
		return this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
	}
	set v(e) {
		let t = this.v;
		if (Math.abs(t) > .05) {
			let n = e / t;
			this.vx *= n, this.vz *= n;
		} else this.vx = Math.sin(this.h) * e, this.vz = Math.cos(this.h) * e;
	}
	place(t, n, r, i) {
		this.x = t, this.z = n, this.h = r, this.vx = this.vz = this.w = 0, this.steer = 0, this.vy = 0, this.y = e.surface ? e.surface(t, n, i ?? -1e3, this.sh).y : -.25, i != null && e.surface && (this.y = e.surface(t, n, i, this.sh).y);
	}
	get deck() {
		return this.sh.seg;
	}
	jx = 0;
	jz = 0;
	contact(e, t, n, r, i, a = 0, o = 0, s = .35, c = .45, l = 0) {
		let u = this.geometry?.inertia ?? m;
		this.x += e * (n + .01), this.z += t * (n + .01);
		let d = r - this.x, f = i - this.z, p = this.vx + this.w * f - a, h = this.vz - this.w * d - o, g = p * e + h * t;
		if (this.jx = this.jz = 0, g >= 0) return 0;
		let _ = f * e - d * t, v = -(1 + s) * g / (1 + _ * _ / u + l);
		this.vx += v * e, this.vz += v * t, this.w += v * _ / u;
		let y = -t, b = e, x = p * y + h * b, S = f * y - d * b, C = -x / (1 + S * S / u + l);
		C = Math.max(-c * v, Math.min(c * v, C)), this.vx += C * y, this.vz += C * b, this.w += C * S / u, this.jx = v * e + C * y, this.jz = v * t + C * b;
		let w = -g;
		return this.hitCool > 0 || w < 2 ? 0 : (this.hitCool = .25, w);
	}
	update(t, n, r, i, a) {
		let o = Math.abs(n) > Math.abs(this.steer) ? 7 : 10;
		this.steer += (n - this.steer) * Math.min(1, t * o);
		let s = Math.sin(this.h), c = Math.cos(this.h), l = -c, u = s, d = this.vx * s + this.vz * c, p = this.vx * l + this.vz * u, { engine: m, vmax: _, brake: v, grip: y } = this.spec, b = 0;
		b = r ? d < -.3 ? v : m * (1 - Math.max(0, d / _) ** 2) : i ? d > .3 ? -v : -5 : -Math.sign(d) * Math.min(Math.abs(d) / Math.max(t, 1e-6), 1), b -= 4e-4 * d * Math.abs(d), d += b * t, !r && !i && Math.abs(d) < .05 && (d = 0), d = Math.max(-9, Math.min(_, d));
		let x = this.drift ? .55 + 1.2 * Math.min(1.5, Math.abs(p) / Math.max(Math.abs(d), 1)) : 1.15, S = Math.min(Math.abs(p), y * x * t);
		p -= Math.sign(p) * S;
		let C = .62 / (1 + Math.abs(d) / 16), w = -(d / (this.geometry?.wheelbase ?? f)) * Math.tan(C * this.steer), T = y * (this.drift ? 1.45 : 1.05) / Math.max(Math.abs(d), 1);
		w = Math.max(-T, Math.min(T, w));
		let E = 9 / (1 + Math.abs(p) / 3);
		this.w += (w - this.w) * Math.min(1, t * E), this.vx = s * d + l * p, this.vz = c * d + u * p, this.h += this.w * t, this.x += this.vx * t, this.z += this.vz * t, this.hitCool = Math.max(0, this.hitCool - t), this.landed = 0;
		let D = e.surface;
		if (D) {
			let e = D(this.x, this.z, this.y, this.sh).y;
			e >= this.y - .35 ? (this.y = e - this.y > .15 ? this.y + Math.min(e - this.y, (4 + Math.abs(this.v) * .2) * t) : e, this.vy = 0) : (this.vy -= 9.81 * t, this.y += this.vy * t, this.y <= e && (this.landed = -this.vy, this.y = e, this.vy = 0));
			let n = Math.sin(this.h), r = Math.cos(this.h), i = {
				y: 0,
				seg: null
			}, a = this.geometry?.surfaceSpan ?? 1.45, o = this.geometry?.halfWidth ?? .8, s = D(this.x + n * a, this.z + r * a, this.y, i).y, c = D(this.x - n * a, this.z - r * a, this.y, i).y, l = D(this.x + r * o, this.z - n * o, this.y, i).y, u = D(this.x - r * o, this.z + n * o, this.y, i).y, d = Math.min(1, t * 12);
			this.pitch += (Math.atan2(Math.max(-1.2, Math.min(1.2, s - c)), a * 2) - this.pitch) * d, this.roll += (Math.atan2(Math.max(-.6, Math.min(.6, l - u)), o * 2) - this.roll) * d;
		}
		if (this.touch = !1, !a) return this.landed > 4 ? this.landed : 0;
		let O = 0, k = Math.sin(this.h), A = Math.cos(this.h), j = this.geometry?.radius ?? h;
		for (let e of this.geometry?.offsets ?? g) {
			let t = this.x + k * e, n = this.z + A * e;
			for (let e of a.contacts(t, n, j, this.contacts, this.y)) this.touch = !0, O = Math.max(O, this.contact(e.nx, e.nz, e.depth, t - e.nx * j, n - e.nz * j));
		}
		return Math.max(O, this.landed > 4 ? this.landed : 0);
	}
	circles() {
		let e = Math.sin(this.h), t = Math.cos(this.h);
		return (this.geometry?.offsets ?? g).map((n) => [this.x + e * n, this.z + t * n]);
	}
	static RADIUS = h;
}, y = {
	sedan: _,
	taxi: {
		..._,
		mass: 1.05
	},
	muscle: {
		engine: 10.5,
		vmax: 64,
		brake: 15,
		grip: 12.5,
		mass: 1.15
	},
	f1: {
		engine: 15,
		vmax: 88,
		brake: 30,
		grip: 24,
		mass: .55
	},
	super: {
		engine: 13,
		vmax: 80,
		brake: 22,
		grip: 18,
		mass: 1.05
	},
	police: {
		engine: 10,
		vmax: 58,
		brake: 18,
		grip: 15,
		mass: 1.25
	},
	pickup: {
		engine: 6.5,
		vmax: 33,
		brake: 12,
		grip: 11,
		mass: 1.5
	}
}, b = class {
	d;
	adj = /* @__PURE__ */ new Map();
	constructor(e) {
		this.d = e;
		let t = e.net.nodes;
		for (let n of [...e.net.ways, ...e.net.decks ?? []]) if (n.c <= 3) for (let e = 1; e < n.n.length; e++) {
			let r = n.n[e - 1], i = n.n[e], a = Math.hypot(t[r * 2] - t[i * 2], t[r * 2 + 1] - t[i * 2 + 1]);
			if (a < .001) continue;
			let o = (e, t) => {
				let r = this.adj.get(e);
				r || this.adj.set(e, r = []), r.push({
					to: t,
					length: a,
					elevated: !!n.e
				});
			};
			n.o !== -1 && o(r, i), n.o !== 1 && o(i, r);
		}
	}
	route(e, t, n) {
		let r = this.d.net.nodes, i = this.d.net.y ?? [], a = e.edge, o = t.edge, s = [], c = /* @__PURE__ */ new Map();
		(a.backward || e.t < 1e-9) && s.push({
			to: a.a,
			length: e.t * a.length,
			elevated: !!a.elevated
		}), (a.forward || e.t > 1 - 1e-9) && s.push({
			to: a.b,
			length: (1 - e.t) * a.length,
			elevated: !!a.elevated
		}), (o.forward || t.t < 1e-9) && c.set(o.a, {
			to: -2,
			length: t.t * o.length,
			elevated: !!o.elevated
		}), (o.backward || t.t > 1 - 1e-9) && c.set(o.b, {
			to: -2,
			length: (1 - t.t) * o.length,
			elevated: !!o.elevated
		}), a.a === o.a && a.b === o.b && (t.t >= e.t && a.forward || t.t <= e.t && a.backward) && s.push({
			to: -2,
			length: Math.abs(t.t - e.t) * a.length,
			elevated: !!a.elevated
		});
		let l = (n) => n === -1 ? [
			e.x,
			e.z,
			e.y
		] : n === -2 ? [
			t.x,
			t.z,
			t.y
		] : [
			r[n * 2],
			r[n * 2 + 1],
			i[n] ?? 0
		], u = {
			key: "start",
			node: -1,
			prevNode: -1,
			cost: 0,
			length: 0,
			turns: 0,
			elevated: 0,
			parent: null
		}, d = /* @__PURE__ */ new Map([["start", 0]]), f = [u], p = (e) => {
			f.push(e);
			let t = f.length - 1;
			for (; t;) {
				let n = t - 1 >> 1;
				if (f[n].cost <= e.cost) break;
				f[t] = f[n], t = n;
			}
			f[t] = e;
		}, m = () => {
			let e = f[0], t = f.pop();
			if (f.length) {
				let e = 0;
				for (; e * 2 + 1 < f.length;) {
					let n = e * 2 + 1;
					if (n + 1 < f.length && f[n + 1].cost < f[n].cost && n++, f[n].cost >= t.cost) break;
					f[e] = f[n], e = n;
				}
				f[e] = t;
			}
			return e;
		}, h = null;
		for (; f.length;) {
			let e = m();
			if (e.cost !== d.get(e.key)) continue;
			if (e.node === -2) {
				h = e;
				break;
			}
			let t = e.node === -1 ? s : [...this.adj.get(e.node) ?? [], ...c.has(e.node) ? [c.get(e.node)] : []];
			for (let r of t) {
				let t = l(e.prevNode), i = l(e.node), a = l(r.to), o = i[0] - t[0], s = i[1] - t[1], c = a[0] - i[0], u = a[1] - i[1], f = Math.abs(Math.atan2(o * u - s * c, o * c + s * u)), m = e.parent && Math.hypot(o, s) > .01 && Math.hypot(c, u) > .01 && f > .5 ? 1 : 0, h = e.cost + r.length * (n === "avoid-elevated" && r.elevated ? 25 : 1) + (n === "few-turns" ? m * 200 : 0), g = `${e.node}:${r.to}`;
				h >= (d.get(g) ?? Infinity) || (d.set(g, h), p({
					key: g,
					node: r.to,
					prevNode: e.node,
					cost: h,
					length: e.length + r.length,
					turns: e.turns + m,
					elevated: e.elevated + (r.elevated ? r.length : 0),
					parent: e
				}));
			}
		}
		if (!h) return null;
		let g = [];
		for (let e = h; e; e = e.parent) g.push(e.node);
		g.reverse();
		let _ = [], v = [];
		for (let e of g) {
			let t = l(e), n = _.at(-1);
			n && Math.hypot(t[0] - n[0], t[1] - n[1]) < .001 || (_.push([t[0], t[1]]), v.push(t[2]));
		}
		return {
			path: _,
			ys: v,
			length: h.length,
			junctions: h.turns,
			turns: h.turns,
			elevatedMeters: h.elevated,
			estimatedSeconds: Math.ceil(h.length / 8.3 + h.turns * 5),
			preference: n
		};
	}
}, x = class {
	data;
	navigationPreference = "legacy";
	N;
	Y;
	adj = /* @__PURE__ */ new Map();
	grid = new o(40);
	tmp = [];
	junctionNodes = /* @__PURE__ */ new Set();
	edges = new o(80);
	preferred = null;
	constructor(e) {
		this.data = e;
		let t = e;
		this.N = t.net.nodes, this.Y = t.net.y ?? [];
		let n = this.N, r = /* @__PURE__ */ new Set(), i = /* @__PURE__ */ new Map(), a = [];
		for (let e of [...t.net.ways, ...t.net.decks ?? []]) if (!(e.c > 3)) for (let t = 0; t + 1 < e.n.length; t++) {
			let o = e.n[t], s = e.n[t + 1], c = Math.hypot(n[s * 2] - n[o * 2], n[s * 2 + 1] - n[o * 2 + 1]);
			if (!e.e) for (let [e, t] of [[o, s], [s, o]]) {
				let n = i.get(e);
				n || i.set(e, n = /* @__PURE__ */ new Set()), n.add(t);
			}
			let l = c * (e.e ? .75 : e.c >= 3 ? 1.6 : 1), u = (e, t) => {
				let n = this.adj.get(e);
				n || this.adj.set(e, n = []), n.push([t, l]);
			};
			e.o !== -1 && u(o, s), e.o !== 1 && u(s, o), e.c <= 2 && (r.add(o), r.add(s)), e.c <= 2 && c > 0 && a.push({
				a: o,
				b: s,
				forward: e.o !== -1,
				backward: e.o !== 1,
				length: c,
				factor: e.e ? .75 : 1,
				elevated: !!e.e
			});
		}
		for (let [e, t] of i) t.size >= 3 && this.junctionNodes.add(e);
		let o = (e, t) => {
			let n = /* @__PURE__ */ new Map();
			if (t) for (let [e, t] of this.adj) for (let [r] of t) {
				let t = n.get(r);
				t || n.set(r, t = []), t.push(e);
			}
			let r = /* @__PURE__ */ new Set([e]), i = [e];
			for (; i.length;) {
				let e = i.pop(), a = t ? n.get(e) || [] : (this.adj.get(e) || []).map((e) => e[0]);
				for (let e of a) r.has(e) || (r.add(e), i.push(e));
			}
			return r;
		}, s = -1, c = Infinity;
		for (let e of r) {
			let t = n[e * 2] ** 2 + n[e * 2 + 1] ** 2;
			t < c && (c = t, s = e);
		}
		let l = s >= 0 ? o(s, !1) : /* @__PURE__ */ new Set(), u = s >= 0 ? o(s, !0) : /* @__PURE__ */ new Set();
		for (let e of r) l.has(e) && u.has(e) && this.grid.addBox(n[e * 2], n[e * 2 + 1], n[e * 2], n[e * 2 + 1], e);
		for (let e of a) l.has(e.a) && u.has(e.a) && l.has(e.b) && u.has(e.b) && this.edges.addBox(Math.min(n[e.a * 2], n[e.b * 2]), Math.min(n[e.a * 2 + 1], n[e.b * 2 + 1]), Math.max(n[e.a * 2], n[e.b * 2]), Math.max(n[e.a * 2 + 1], n[e.b * 2 + 1]), e);
	}
	project(e, t, r) {
		let i = r ?? n(e, t), a = this.N, o = null, s = Infinity;
		for (let n of [
			60,
			150,
			400
		]) {
			for (let r of this.edges.query(e, t, n)) {
				let n = a[r.a * 2], c = a[r.a * 2 + 1], l = a[r.b * 2] - n, u = a[r.b * 2 + 1] - c, d = Math.max(0, Math.min(1, ((e - n) * l + (t - c) * u) / (r.length * r.length))), f = n + l * d, p = c + u * d, m = (this.Y[r.a] ?? 0) * (1 - d) + (this.Y[r.b] ?? 0) * d, h = (f - e) ** 2 + (p - t) ** 2 + ((m - i) * 8) ** 2;
				h < s && (s = h, o = {
					edge: r,
					t: d,
					x: f,
					z: p,
					y: m
				});
			}
			if (o && s < n * n) return o;
		}
		return o;
	}
	nearest(e, t, r) {
		let i = this.N, a = this.Y, o = r ?? n(e, t);
		for (let n of [
			60,
			150,
			400
		]) {
			let r = -1, s = Infinity;
			for (let c of this.grid.query(e, t, n, this.tmp)) {
				let n = (i[c * 2] - e) ** 2 + (i[c * 2 + 1] - t) ** 2 + (((a[c] ?? 0) - o) * 8) ** 2;
				n < s && (s = n, r = c);
			}
			if (r >= 0) return r;
		}
		return -1;
	}
	routeWithPreference(e, t, n, r, i, a, o) {
		if (e === "legacy") return this.route(t, n, r, i, a, o);
		if (![
			"shortest",
			"few-turns",
			"avoid-elevated"
		].includes(e)) return null;
		let s = this.project(t, n, a), c = this.project(r, i, o);
		return !s || !c ? null : (this.preferred ??= new b(this.data), this.preferred.route(s, c, e));
	}
	route(e, t, n, r, i, a) {
		let o = this.project(e, t, i), s = this.project(n, r, a);
		if (!o || !s) return null;
		let c = [], l = /* @__PURE__ */ new Map(), u = o.edge, d = s.edge;
		(u.backward || o.t < 1e-9) && c.push([u.a, o.t * u.length * u.factor]), (u.forward || o.t > 1 - 1e-9) && c.push([u.b, (1 - o.t) * u.length * u.factor]), (d.forward || s.t < 1e-9) && l.set(d.a, s.t * d.length * d.factor), (d.backward || s.t > 1 - 1e-9) && l.set(d.b, (1 - s.t) * d.length * d.factor), u === d && (s.t >= o.t && u.forward || s.t <= o.t && u.backward) && c.push([-2, Math.abs(s.t - o.t) * u.length * u.factor]);
		let f = /* @__PURE__ */ new Map([[-1, 0]]), p = /* @__PURE__ */ new Map(), m = [[0, -1]], h = (e) => {
			m.push(e);
			let t = m.length - 1;
			for (; t > 0;) {
				let e = t - 1 >> 1;
				if (m[e][0] <= m[t][0]) break;
				[m[e], m[t]] = [m[t], m[e]], t = e;
			}
		}, g = () => {
			let e = m[0], t = m.pop();
			if (m.length) {
				m[0] = t;
				let e = 0;
				for (;;) {
					let t = e * 2 + 1, n = t + 1, r = e;
					if (t < m.length && m[t][0] < m[r][0] && (r = t), n < m.length && m[n][0] < m[r][0] && (r = n), r === e) break;
					[m[r], m[e]] = [m[e], m[r]], e = r;
				}
			}
			return e;
		};
		for (; m.length;) {
			let [e, t] = g();
			if (e > (f.get(t) ?? Infinity)) continue;
			if (t === -2) break;
			let n = t === -1 ? c : [...this.adj.get(t) || []];
			l.has(t) && n.push([-2, l.get(t)]);
			for (let [r, i] of n) {
				let n = e + i;
				n < (f.get(r) ?? Infinity) && (f.set(r, n), p.set(r, t), h([n, r]));
			}
		}
		if (!f.has(-2)) return null;
		let _ = [-2];
		for (; _[0] !== -1;) _.unshift(p.get(_[0]));
		let v = this.N, y = [[o.x, o.z]], b = [o.y];
		for (let e of _.slice(1, -1)) {
			let t = [v[e * 2], v[e * 2 + 1]];
			Math.hypot(t[0] - y[y.length - 1][0], t[1] - y[y.length - 1][1]) > .001 && (y.push(t), b.push(this.Y[e] ?? 0));
		}
		Math.hypot(s.x - y[y.length - 1][0], s.z - y[y.length - 1][1]) > .001 && (y.push([s.x, s.z]), b.push(s.y));
		for (let e = 0; e < 2 && y.length > 2; e++) {
			let e = [y[0]], t = [b[0]];
			for (let n = 0; n + 1 < y.length; n++) {
				let [r, i] = [y[n], y[n + 1]];
				e.push([r[0] * .75 + i[0] * .25, r[1] * .75 + i[1] * .25], [r[0] * .25 + i[0] * .75, r[1] * .25 + i[1] * .75]), t.push(b[n] * .75 + b[n + 1] * .25, b[n] * .25 + b[n + 1] * .75);
			}
			e.push(y[y.length - 1]), t.push(b[b.length - 1]), y = e, b = t;
		}
		let x = 0;
		for (let e = 1; e < y.length; e++) x += Math.hypot(y[e][0] - y[e - 1][0], y[e][1] - y[e - 1][1]);
		let S = _.slice(1, -1).filter((e) => this.junctionNodes.has(e)).length;
		return {
			path: y,
			ys: b,
			length: x,
			junctions: S
		};
	}
}, S = "city-workshop-v1", C = "city-workshop-v2", w = [
	"sedan",
	"taxi",
	"muscle",
	"f1",
	"super",
	"police",
	"pickup"
], T = [
	"day",
	"dusk",
	"night",
	"rain",
	"rainnight"
], E = (e) => !!e && typeof e == "object" && !Array.isArray(e), D = (e) => typeof e == "number" && Number.isFinite(e);
function O(e) {
	let t = 2166136261;
	for (let n = 0; n < e.length; n++) t ^= e.charCodeAt(n), t = Math.imul(t, 16777619);
	return (t >>> 0).toString(16).padStart(8, "0");
}
function k(e) {
	if (!E(e)) return null;
	let t = e.v === 2;
	if (Object.keys(e).sort().join(",") !== (t ? "car,hits,laps,map,name,nodes,physics,seconds,splits,v,weather" : "car,hits,map,name,nodes,physics,seconds,v,weather") || (t ? e.physics !== "city-workshop-v2" : e.v !== 1 || e.physics !== "city-workshop-v1") || typeof e.map != "string" || !/^roads-v1:[0-9a-f]{8}$/.test(e.map) || typeof e.name != "string" || e.name.length < 1 || e.name.length > 36 || e.name.trim() !== e.name || /[\x00-\x1f\x7f<>]/.test(e.name) || !Array.isArray(e.nodes) || e.nodes.length < 2 || e.nodes.length > 12 || e.nodes.some((t, n) => !Number.isSafeInteger(t) || t < 0 || t > 1e7 || n > 0 && e.nodes instanceof Array && t === e.nodes[n - 1]) || !w.includes(e.car) || !T.includes(e.weather) || !D(e.seconds) || !Number.isInteger(e.seconds) || e.seconds < 15 || e.seconds > 1800 || !D(e.hits) || !Number.isInteger(e.hits) || e.hits < 0 || e.hits > 20) return null;
	let n = {
		map: e.map,
		name: e.name,
		nodes: [...e.nodes],
		car: e.car,
		weather: e.weather,
		seconds: e.seconds,
		hits: e.hits
	};
	return t ? ![
		1,
		3,
		5
	].includes(e.laps) || !Array.isArray(e.splits) || e.splits.length > 2 || e.splits.some((e, t, n) => !Number.isSafeInteger(e) || e < 1 || e > 666 || t > 0 && e <= n[t - 1]) || e.laps !== 1 && !M(n.nodes) ? null : {
		v: 2,
		physics: C,
		...n,
		laps: e.laps,
		splits: [...e.splits]
	} : {
		v: 1,
		physics: S,
		...n
	};
}
function A(e) {
	let t = k(e);
	if (!t) throw Error("挑戰設定無效");
	let n = new TextEncoder().encode(JSON.stringify(t)), r = "";
	for (let e of n) r += String.fromCharCode(e);
	let i = btoa(r).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
	return `NG${t.v}.${i}.${O(i)}`;
}
function j(e) {
	if (e.length > 4096) throw Error("分享碼過長，請使用工坊產生的分享碼");
	let t = e.trim(), n = /^NG([12])\.([A-Za-z0-9_-]{10,3500})\.([0-9a-f]{8})$/.exec(t);
	if (!n || O(n[2]) !== n[3]) throw Error("分享碼不完整或已損壞");
	try {
		let e = atob(n[2].replaceAll("-", "+").replaceAll("_", "/")), t = k(JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(Uint8Array.from(e, (e) => e.charCodeAt(0)))));
		if (t && String(t.v) === n[1]) return t;
	} catch {}
	throw Error("挑戰版本或設定不支援，請請朋友重新產生分享碼");
}
function M(e) {
	return e.length >= 3 && e[0] === e.at(-1);
}
var N = class {
	data;
	stamp;
	nodes = /* @__PURE__ */ new Map();
	router;
	constructor(e) {
		this.data = e, this.router = new x(e), this.stamp = `roads-v1:${O(JSON.stringify(e.net))}`;
		for (let t of [...e.net.ways, ...e.net.decks ?? []]) if (t.c <= 2) for (let n of t.n) {
			let r = e.net.nodes[n * 2], i = e.net.nodes[n * 2 + 1], a = e.net.y?.[n] ?? 0;
			D(r) && D(i) && D(a) && this.nodes.set(n, {
				x: r,
				z: i,
				y: a,
				name: t.nm || "道路節點",
				elevated: !!t.e
			});
		}
	}
	nearest(e, t, n = "all", r = 90) {
		if (!D(e) || !D(t)) return null;
		let i = null;
		for (let [a, o] of this.nodes) {
			if (n === "ground" && o.elevated || n === "deck" && !o.elevated) continue;
			let s = Math.hypot(e - o.x, t - o.z);
			s <= r && (!i || s < i.distance) && (i = {
				id: a,
				point: o,
				distance: s
			});
		}
		return i;
	}
	route(e) {
		if (e.length < 2 || e.length > 12) throw Error("請設定起點、終點，最多 12 個路線點");
		let t = e.map((e) => {
			let t = this.nodes.get(e);
			if (!t) throw Error("路線點不在目前可駕駛道路");
			return {
				x: t.x,
				z: t.z,
				y: t.y
			};
		}), n = [], r = [], i = 0;
		for (let e = 1; e < t.length; e++) {
			let a = t[e - 1], o = t[e];
			if (Math.hypot(a.x - o.x, a.z - o.z) < 25 && Math.abs(a.y - o.y) < 3) throw Error(`第 ${e}、${e + 1} 點太近，請拉開至少 25 公尺`);
			let s = this.router.route(a.x, a.z, o.x, o.z, a.y, o.y);
			if (!s || s.length < 25 || Math.abs(s.ys[0] - a.y) > 2 || Math.abs(s.ys.at(-1) - o.y) > 2) throw Error(`第 ${e} → ${e + 1} 點無法沿單行方向與相同路層到達`);
			if (Math.hypot(s.path[0][0] - a.x, s.path[0][1] - a.z) > 4 || Math.hypot(s.path.at(-1)[0] - o.x, s.path.at(-1)[1] - o.z) > 4) throw Error("路線點無法連接主路網，請換鄰近道路");
			if (i += s.length, i > 2e4) throw Error("路線長度上限 20 公里，請減少折返或路線點");
			n.push(...s.path.slice(+(e > 1))), r.push(...s.ys.slice(+(e > 1)));
		}
		if (i < 100) throw Error("完整路線至少需要 100 公尺");
		if (n.length > 2e4) throw Error("路線過於複雜，請減少路線點");
		let a = [], o = 0;
		for (let e = 1; e < n.length; e++) {
			let t = n[e - 1][0], i = n[e - 1][1], s = r[e - 1], c = Math.hypot(n[e][0] - t, n[e][1] - i);
			for (; o + c >= 30;) {
				let l = (30 - o) / c;
				t += (n[e][0] - t) * l, i += (n[e][1] - i) * l, s += (r[e] - s) * l, a.push({
					x: t,
					z: i,
					y: s
				}), c = Math.hypot(n[e][0] - t, n[e][1] - i), o = 0;
			}
			o += c;
		}
		let s = n.at(-1);
		a.push({
			x: s[0],
			z: s[1],
			y: r.at(-1)
		});
		let c = n[0], l = n.find((e) => Math.hypot(e[0] - c[0], e[1] - c[1]) > .5);
		return {
			path: n,
			ys: r,
			length: i,
			anchors: t,
			gates: a,
			start: {
				x: c[0],
				z: c[1],
				y: r[0],
				h: Math.atan2(l[0] - c[0], l[1] - c[1])
			}
		};
	}
	validate(e) {
		if (!k(e)) throw Error("挑戰設定無效");
		if (e.map !== this.stamp) throw Error("城市地圖已更新，這份挑戰的路線版本不同；請重新編輯再分享");
		let t = this.route(e.nodes);
		if (e.v === 2) {
			let n = t.gates.at(-1), r = t.gates.at(-2);
			if (r && Math.hypot(n.x - r.x, n.z - r.z, n.y - r.y) < .001 && t.gates.pop(), e.splits.some((e) => e >= t.gates.length)) throw Error("計時分段超出路線，請重新設定");
		}
		return t;
	}
};
//#endregion
//#region shared/atlas-city-contact.ts
function P(e, t) {
	if (Math.abs(e.y - t.y) > 1.6 || Math.hypot(e.x - t.x, e.z - t.z) > 8) return {
		touch: !1,
		impact: 0
	};
	let n = e.geometry?.radius ?? .95, r = t.geometry?.radius ?? .95, i = e.geometry?.offsets ?? [
		1.45,
		0,
		-1.45
	], a = t.geometry?.offsets ?? [
		1.45,
		0,
		-1.45
	], o = null;
	for (let s of i) for (let i of a) {
		let a = e.x + Math.sin(e.h) * s, c = e.z + Math.cos(e.h) * s, l = t.x + Math.sin(t.h) * i, u = t.z + Math.cos(t.h) * i, d = a - l, f = c - u, p = Math.hypot(d, f), m = n + r - p;
		m <= 0 || o && o.depth >= m || (o = {
			nx: p > 1e-4 ? d / p : 1,
			nz: p > 1e-4 ? f / p : 0,
			depth: m,
			cx: (a + l) / 2,
			cz: (c + u) / 2
		});
	}
	if (!o) return {
		touch: !1,
		impact: 0
	};
	let { nx: s, nz: c, depth: l, cx: u, cz: d } = o, f = Math.max(.1, Math.min(10, e.spec.mass / t.spec.mass)), p = t.vx + t.w * (d - t.z), m = t.vz - t.w * (u - t.x), h = e.contact(s, c, l * .5, u, d, p, m, .18, .18, f);
	return t.x -= s * (l * .5 + .01), t.z -= c * (l * .5 + .01), t.vx -= e.jx * f, t.vz -= e.jz * f, t.w -= ((d - t.z) * e.jx - (u - t.x) * e.jz) * f / (t.geometry?.inertia ?? 2.2), e.w = Math.max(-2.5, Math.min(2.5, e.w)), t.w = Math.max(-2.5, Math.min(2.5, t.w)), {
		touch: !0,
		impact: h
	};
}
//#endregion
//#region src/aurora-story.ts
var F = (e) => !!e && typeof e == "object" && !Array.isArray(e);
function I(e) {
	try {
		if (!F(e) || Object.keys(e).sort().join(",") !== "physics,route,stages,v" || e.v !== 1 || e.physics !== "city-story-v1" || typeof e.route != "string") return null;
		let t = j(e.route);
		if (t.v !== 1 || !Array.isArray(e.stages) || e.stages.length !== t.nodes.length - 1) return null;
		let n = [];
		for (let t of e.stages) {
			if (!F(t) || Object.keys(t).sort().join(",") !== "action,dwell,label,optional" || typeof t.label != "string" || t.label.trim() !== t.label || t.label.length < 1 || t.label.length > 40 || /[\x00-\x1f\x7f<>]/.test(t.label) || ![
				"arrival",
				"parking",
				"cargo"
			].includes(String(t.action)) || !Number.isInteger(t.dwell) || Number(t.dwell) < 0 || Number(t.dwell) > 30 || t.action === "arrival" && t.dwell !== 0 || t.action !== "arrival" && Number(t.dwell) < 2 || typeof t.optional != "boolean") return null;
			n.push({
				label: t.label,
				action: t.action,
				dwell: Number(t.dwell),
				optional: t.optional
			});
		}
		return n.at(-1)?.optional ? null : {
			v: 1,
			physics: "city-story-v1",
			route: A(t),
			stages: n
		};
	} catch {
		return null;
	}
}
function L(e) {
	let t = I(e);
	if (!t) throw Error("劇本條件無效");
	let n = "";
	for (let e of new TextEncoder().encode(JSON.stringify(t))) n += String.fromCharCode(e);
	let r = btoa(n).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
	return `NG3.${r}.${O(r)}`;
}
function R(e) {
	if (e.length > 12e3) throw Error("劇本分享碼過長");
	let t = /^NG3\.([A-Za-z0-9_-]{10,11000})\.([0-9a-f]{8})$/.exec(e.trim());
	if (!t || O(t[1]) !== t[2]) throw Error("劇本分享碼已損壞");
	try {
		let e = atob(t[1].replaceAll("-", "+").replaceAll("_", "/")), n = I(JSON.parse(new TextDecoder("utf-8", { fatal: !0 }).decode(Uint8Array.from(e, (e) => e.charCodeAt(0)))));
		if (n) return n;
	} catch {}
	throw Error("劇本版本或階段不支援");
}
function z(e, t, n) {
	let r = I(t);
	if (!r) throw Error("劇本無效");
	let i = j(r.route);
	e.validate(i), n && r.stages.some((e) => e.optional) && z(e, r, !1);
	let a = r.stages.map((e, t) => ({
		...e,
		node: i.nodes[t + 1],
		source: t
	})).filter((e) => n || !e.optional), o = {
		...i,
		nodes: [i.nodes[0], ...a.map((e) => e.node)]
	}, s = e.validate(o), c = 0, l = 0, u = [];
	for (let e = 0; e < a.length; e++) {
		let t = s.anchors[e + 1], n = -1;
		for (let e = c + 1; e < s.path.length; e++) if (Math.hypot(s.path[e][0] - t.x, s.path[e][1] - t.z) < 4 && Math.abs(s.ys[e] - t.y) < 2) {
			n = e;
			break;
		}
		if (n < 0) throw Error("劇本停靠點不在重建道路");
		for (let e = c + 1; e <= n; e++) l += Math.hypot(s.path[e][0] - s.path[e - 1][0], s.path[e][1] - s.path[e - 1][1]);
		c = n;
		let r = s.path[Math.max(0, c - 1)];
		u.push({
			...a[e],
			...t,
			h: Math.atan2(t.x - r[0], t.z - r[1]),
			gateEnd: e === a.length - 1 ? s.gates.length : Math.min(s.gates.length, Math.floor(l / 30))
		});
	}
	return {
		definition: o,
		route: s,
		targets: u,
		skipped: r.stages.length - a.length
	};
}
//#endregion
//#region src/meridian-city-models.ts
var B = (e) => Math.atan2(Math.sin(e), Math.cos(e));
function V(e) {
	let t = e.nearest(467.12, 515.8, "ground", 250) ?? [...e.nodes].filter(([, e]) => !e.elevated).map(([e, t]) => ({
		id: e,
		point: t
	}))[0];
	if (!t) throw Error("城市沒有可用尋寶道路");
	let n = [t.id], r = [], i = /* @__PURE__ */ new Set(), a = t.point;
	for (let t = 0; t < 3; t++) {
		let t = [...e.nodes].filter(([e, t]) => !t.elevated && !n.includes(e) && t.name !== "道路節點" && !i.has(t.name) && Math.hypot(t.x - a.x, t.z - a.z) > 140 && Math.hypot(t.x - a.x, t.z - a.z) < 1e3).sort((e, t) => Math.hypot(e[1].x - a.x, e[1].z - a.z) - Math.hypot(t[1].x - a.x, t[1].z - a.z) || e[0] - t[0]), o = !1;
		for (let [s, c] of t.slice(0, 120)) try {
			if (e.route([...n, s]).length > 6e3) continue;
			n.push(s), i.add(c.name), r.push(c.name), a = c, o = !0;
			break;
		} catch {}
		if (!o) throw Error("目前城市無法組成三站可識別路牌尋寶");
	}
	let o = {
		v: 1,
		physics: "city-story-v1",
		route: A({
			v: 1,
			physics: S,
			map: e.stamp,
			name: "城市路牌照片尋寶",
			nodes: n,
			car: "sedan",
			weather: "day",
			seconds: 1800,
			hits: 20
		}),
		stages: r.map((e) => ({
			label: `尋找「${e}」路牌附近`.slice(0, 40),
			action: "arrival",
			dwell: 0,
			optional: !1
		}))
	};
	return {
		story: o,
		plan: z(e, o, !0),
		code: L(o)
	};
}
var H = class {
	mode;
	story;
	plan;
	index = 0;
	gate = 0;
	elapsed = 0;
	dwell = 0;
	hits = 0;
	done = !1;
	success = !1;
	reason = "";
	tasks = [];
	photos = [];
	lastHit = -100;
	current = "";
	constructor(e, t, n) {
		this.mode = e, this.story = t, this.plan = n;
	}
	get target() {
		return this.plan.targets[this.index];
	}
	fail(e) {
		this.done || (this.done = !0, this.success = !1, this.reason = e);
	}
	role(e) {
		return [
			"司機：對準停穩",
			"裝卸員：長按作業",
			"領航員：實地核對路牌",
			"警戒員：確認周邊淨空"
		][e] ?? "隊員";
	}
	setup(e) {
		let t = this.index + ":" + e.map((e) => e.id).join(",");
		if (t === this.current) return;
		this.current = t;
		let n = this.target;
		this.tasks = e.map((e, t) => ({
			id: e.id,
			role: this.mode === "hunt" ? "攝影隊員" : this.role(t),
			seconds: 0,
			required: this.mode === "hunt" ? 0 : t === 0 ? Math.max(.5, n.action === "arrival" ? .5 : n.dwell) : n.action === "cargo" && t === 1 ? Math.max(2, n.dwell) : t === 2 ? 1.5 : 2,
			done: this.mode === "hunt"
		}));
	}
	capture(e, t) {
		if (this.done || this.mode !== "hunt") return !1;
		let n = e.find((e) => e.id === t), r = this.target;
		return !n?.connected || Math.hypot(n.pose.x - r.x, n.pose.z - r.z) >= 12 || Math.abs(n.pose.y - -.25 - r.y) >= 1.2 || Math.hypot(n.pose.vx, n.pose.vz) >= .5 || ![
			n.pose.x,
			n.pose.y,
			n.pose.z,
			n.pose.vx,
			n.pose.vz
		].every(Number.isFinite) ? !1 : (this.photos.push({
			stage: this.index,
			by: t,
			seconds: this.elapsed
		}), this.advance(), !0);
	}
	step(e, t, n, r = 0) {
		if (this.done) return;
		if (!Number.isFinite(e) || e <= 0 || e > .1 || !t.length || t.length > 4) return this.fail("任務模擬或隊伍無效");
		if (this.elapsed += e, this.elapsed > this.plan.definition.seconds) {
			this.fail("任務時間已到");
			return;
		}
		if (r > 6 && this.elapsed - this.lastHit > .75 && (this.hits++, this.lastHit = this.elapsed), this.hits > this.plan.definition.hits) {
			this.fail("碰撞超過劇本上限");
			return;
		}
		this.setup(t);
		let i = this.target, a = t[0], o = a.pose, s = this.plan.route.gates[this.gate];
		this.mode === "story" && this.gate < i.gateEnd && s && Math.hypot(o.x - s.x, o.z - s.z) < 12 && Math.abs(o.y - -.25 - s.y) < 2.2 && this.gate++;
		let c = (e, t) => e.connected && Math.hypot(e.pose.x - i.x, e.pose.z - i.z) < t && Math.abs(e.pose.y - -.25 - i.y) < 1.2 && Math.hypot(e.pose.vx, e.pose.vz) < .5;
		if (this.mode === "hunt") {
			n && this.capture(t, n);
			return;
		}
		let l = this.gate >= i.gateEnd && c(a, i.action === "arrival" ? 9 : 3) && (i.action === "arrival" || Math.abs(B(o.h - i.h)) < .3);
		this.dwell = l ? Math.min(i.dwell || .5, this.dwell + e) : 0;
		for (let [n, r] of this.tasks.entries()) {
			let a = t[n];
			r.seconds = l && c(a, n === 0 ? 9 : 18) && (n === 0 && i.action !== "cargo" || a.held) ? Math.min(r.required, r.seconds + e) : 0, r.done = r.seconds >= r.required;
		}
		this.tasks.every((e) => e.done) && this.advance();
	}
	advance() {
		this.index++, this.dwell = 0, this.current = "", this.tasks = [], this.index === this.plan.targets.length && (this.done = this.success = !0, this.reason = this.mode === "hunt" ? "全隊已依序找到並拍攝所有線索。" : "全隊已完成所有分工階段。");
	}
	snapshot() {
		return {
			mode: this.mode,
			index: this.index,
			total: this.plan.targets.length,
			elapsed: this.elapsed,
			dwell: this.dwell,
			hits: this.hits,
			gate: this.gate,
			done: this.done,
			success: this.success,
			reason: this.reason,
			clue: this.target?.label ?? this.reason,
			tasks: structuredClone(this.tasks),
			photos: structuredClone(this.photos)
		};
	}
};
//#endregion
//#region server/summit-city-physics-entry.ts
function U(t, n = []) {
	let r = i(t), a = new l(r), o = new s(r);
	a.tunnels = !0, o.groundAt = (e, t) => a.groundAt(e, t);
	for (let t of n) o.addBuildings(e(t).buildings);
	for (let e of a.rails) o.addWall(e.x1, e.z1, e.x2, e.z2, e.y1, e.y2);
	return {
		data: r,
		surface: a,
		collider: o,
		roads: new N(r),
		surfaceAt: (e, t, n, r) => a.at(e, t, n, r),
		spec(e, t = !1) {
			let n = y[e];
			if (!n) throw Error("城市競速車款不支援");
			return {
				...n,
				grip: n.grip * (t ? .82 : 1)
			};
		}
	};
}
//#endregion
export { H as CityMissionRun, v as FreeCar, c as ROAD_Y, V as buildPhotoHunt, z as buildStoryPlan, U as createCityRaceWorld, R as decodeStory, j as decodeWorkshop, L as encodeStory, A as encodeWorkshop, k as parseWorkshop, P as streetContact };
