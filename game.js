(async () => {
    const stage = document.getElementById('stage');
    const res = await fetch('floorplan.svg');
    stage.innerHTML = await res.text();
    const svg = stage.querySelector('svg');
    const NS = 'http://www.w3.org/2000/svg';
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', NS);

    const vb = svg.viewBox.baseVal;
    const VIEW = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };

    function el(name, attrs) {
        const n = document.createElementNS(NS, name);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        return n;
    }

    const obstacles = [];
    function viewBoxTransform() {
        const sr = svg.getBoundingClientRect();
        if (sr.width <= 0 || sr.height <= 0) return null;
        const par = (svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim().split(/\s+/);
        const align = par[0] || 'xMidYMid';
        const slice = par[1] === 'slice';
        const s = (slice ? Math.max : Math.min)(sr.width / VIEW.w, sr.height / VIEW.h);
        const cw = VIEW.w * s, ch = VIEW.h * s;
        let ox = (sr.width - cw) / 2, oy = (sr.height - ch) / 2;
        const xmode = align.slice(1, 4), ymode = align.slice(5, 8);
        if (xmode === 'Min') ox = 0; else if (xmode === 'Max') ox = sr.width - cw;
        if (ymode === 'Min') oy = 0; else if (ymode === 'Max') oy = sr.height - ch;
        return (sx, sy) => [(sx - sr.left - ox) / s, (sy - sr.top - oy) / s];
    }

    function readObstacles() {
        obstacles.length = 0;
        const toVb = viewBoxTransform();
        if (!toVb) return;
        const rects = svg.querySelectorAll('[id^="seat-"] rect');
        for (const r of rects) {
            let bb = null;
            try { bb = r.getBBox(); } catch (e) {}
            if (!bb || bb.width <= 0 || bb.height <= 0) {
                const cs = getComputedStyle(r);
                bb = { x: 0, y: 0, width: parseFloat(cs.width) || 17, height: parseFloat(cs.height) || 12 };
            }
            const m = r.getScreenCTM();
            if (!m) continue;
            const x = bb.x, y = bb.y, w = bb.width, h = bb.height;
            const quad = [
                [x, y], [x + w, y], [x + w, y + h], [x, y + h]
            ].map(([px, py]) => {
                const v = toVb(m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f);
                return [v[0], v[1]];
            });
            obstacles.push(quad);
        }
    }

    const PLAYER_R = 5;
    const FIELD = [
        [173, 123], [404, 123], [404, 149], [449, 154], [472, 315],
        [410, 315], [408, 276], [326, 280], [326, 315], [150, 315],
    ];
    const FIELD_CENTROID = FIELD.reduce((a, p) => [a[0] + p[0] / FIELD.length, a[1] + p[1] / FIELD.length], [0, 0]);

    function closestOnSeg(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return [ax + t * dx, ay + t * dy];
    }

    function resolve(p) {
        for (let iter = 0; iter < 2; iter++) {
            for (const q of obstacles) {
                let sign = 0, inside = true;
                for (let i = 0; i < 4; i++) {
                    const a = q[i], b = q[(i + 1) % 4];
                    const cross = (b[0] - a[0]) * (p.y - a[1]) - (b[1] - a[1]) * (p.x - a[0]);
                    if (cross > 1e-9) { if (sign < 0) inside = false; sign = 1; }
                    else if (cross < -1e-9) { if (sign > 0) inside = false; sign = -1; }
                }
                let cx = 0, cy = 0, bd = Infinity;
                for (let i = 0; i < 4; i++) {
                    const a = q[i], b = q[(i + 1) % 4];
                    const g = closestOnSeg(p.x, p.y, a[0], a[1], b[0], b[1]);
                    const d = (g[0] - p.x) * (g[0] - p.x) + (g[1] - p.y) * (g[1] - p.y);
                    if (d < bd) { bd = d; cx = g[0]; cy = g[1]; }
                }
                const dist = Math.sqrt(bd);
                if (inside) {
                    if (dist < 1e-6) {
                        p.x = cx;
                        p.y = q[0][1] - PLAYER_R;
                    } else {
                        p.x = cx + (cx - p.x) / dist * PLAYER_R;
                        p.y = cy + (cy - p.y) / dist * PLAYER_R;
                    }
                } else if (dist < PLAYER_R) {
                    p.x = cx + (p.x - cx) / dist * PLAYER_R;
                    p.y = cy + (p.y - cy) / dist * PLAYER_R;
                }
            }
        }
        resolveField(p);
    }

    function insideField(p) {
        let inside = false;
        for (let i = 0, j = FIELD.length - 1; i < FIELD.length; j = i++) {
            const xi = FIELD[i][0], yi = FIELD[i][1];
            const xj = FIELD[j][0], yj = FIELD[j][1];
            if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    function resolveField(p) {
        for (let iter = 0; iter < 5; iter++) {
            let cx = 0, cy = 0, bd = Infinity;
            for (let i = 0, j = FIELD.length - 1; i < FIELD.length; j = i++) {
                const c = closestOnSeg(p.x, p.y, FIELD[j][0], FIELD[j][1], FIELD[i][0], FIELD[i][1]);
                const d = (c[0] - p.x) * (c[0] - p.x) + (c[1] - p.y) * (c[1] - p.y);
                if (d < bd) { bd = d; cx = c[0]; cy = c[1]; }
            }
            const d = Math.sqrt(bd);
            if (insideField(p)) {
                if (d >= PLAYER_R) return;
                p.x = cx + (p.x - cx) / d * PLAYER_R;
                p.y = cy + (p.y - cy) / d * PLAYER_R;
            } else {
                const dx = FIELD_CENTROID[0] - cx, dy = FIELD_CENTROID[1] - cy;
                const dl = Math.hypot(dx, dy) || 1;
                p.x = cx + (dx / dl) * PLAYER_R;
                p.y = cy + (dy / dl) * PLAYER_R;
            }
        }
        if (!insideField(p)) {
            p.x = FIELD_CENTROID[0];
            p.y = FIELD_CENTROID[1];
        }
    }

    const CELL = 4;
    let fminX = Infinity, fmaxX = -Infinity, fminY = Infinity, fmaxY = -Infinity;
    for (const [x, y] of FIELD) {
        if (x < fminX) fminX = x;
        if (x > fmaxX) fmaxX = x;
        if (y < fminY) fminY = y;
        if (y > fmaxY) fmaxY = y;
    }
    const GX0 = Math.floor((fminX - CELL) / CELL) * CELL;
    const GY0 = Math.floor((fminY - CELL) / CELL) * CELL;
    const GCOLS = Math.ceil((fmaxX + CELL - GX0) / CELL);
    const GROWS = Math.ceil((fmaxY + CELL - GY0) / CELL);

    const blockRects = [];
    const grid = { blocked: null };

    function rebuildGrid() {
        blockRects.length = 0;
        for (const q of obstacles) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const p of q) {
                if (p[0] < x0) x0 = p[0];
                if (p[0] > x1) x1 = p[0];
                if (p[1] < y0) y0 = p[1];
                if (p[1] > y1) y1 = p[1];
            }
            blockRects.push({
                x: x0 - PLAYER_R, y: y0 - PLAYER_R,
                w: x1 - x0 + PLAYER_R * 2, h: y1 - y0 + PLAYER_R * 2,
            });
        }
        const n = GCOLS * GROWS;
        const blocked = new Uint8Array(n);
        for (let j = 0; j < GROWS; j++) {
            for (let i = 0; i < GCOLS; i++) {
                const cx = GX0 + (i + 0.5) * CELL;
                const cy = GY0 + (j + 0.5) * CELL;
                if (!insideField({ x: cx, y: cy })) {
                    blocked[j * GCOLS + i] = 1;
                    continue;
                }
                for (const r of blockRects) {
                    if (cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h) {
                        blocked[j * GCOLS + i] = 1;
                        break;
                    }
                }
            }
        }
        grid.blocked = blocked;
    }

    function cellAt(x, y) {
        const i = Math.floor((x - GX0) / CELL);
        const j = Math.floor((y - GY0) / CELL);
        if (i < 0 || j < 0 || i >= GCOLS || j >= GROWS) return -1;
        return j * GCOLS + i;
    }

    function cellCenter(c) {
        return [GX0 + (c % GCOLS + 0.5) * CELL, GY0 + (Math.floor(c / GCOLS) + 0.5) * CELL];
    }

    const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

    function heapPush(h, f, idx) {
        h.push([f, idx]);
        let i = h.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (h[p][0] <= h[i][0]) break;
            const t = h[p]; h[p] = h[i]; h[i] = t;
            i = p;
        }
    }

    function heapPop(h) {
        const top = h[0];
        const last = h.pop();
        if (h.length > 0) {
            h[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < h.length && h[l][0] < h[m][0]) m = l;
                if (r < h.length && h[r][0] < h[m][0]) m = r;
                if (m === i) break;
                const t = h[m]; h[m] = h[i]; h[i] = t;
                i = m;
            }
        }
        return top;
    }

    function astar(start, goal) {
        if (start < 0 || goal < 0 || start === goal) return null;
        const n = GCOLS * GROWS;
        const g = new Float32Array(n).fill(Infinity);
        const came = new Int32Array(n).fill(-1);
        const done = new Uint8Array(n);
        const gi = goal % GCOLS, gj = Math.floor(goal / GCOLS);
        const hFn = (c) => Math.hypot((c % GCOLS) - gi, Math.floor(c / GCOLS) - gj) * CELL;
        const blocked = (c) => (c === start || c === goal) ? false : grid.blocked[c] === 1;
        const open = [];
        g[start] = 0;
        heapPush(open, hFn(start), start);
        while (open.length > 0) {
            const top = heapPop(open);
            const cur = top[1];
            if (done[cur]) continue;
            done[cur] = 1;
            if (cur === goal) {
                const path = [goal];
                let c = goal;
                while (came[c] !== -1) {
                    c = came[c];
                    path.push(c);
                }
                path.reverse();
                return path;
            }
            const ci = cur % GCOLS, cj = Math.floor(cur / GCOLS);
            for (let d = 0; d < 8; d++) {
                const dx = DIRS[d][0], dy = DIRS[d][1];
                const ni = ci + dx, nj = cj + dy;
                if (ni < 0 || nj < 0 || ni >= GCOLS || nj >= GROWS) continue;
                const nn = nj * GCOLS + ni;
                if (done[nn] || blocked(nn)) continue;
                if (dx !== 0 && dy !== 0) {
                    if (blocked(cj * GCOLS + ni) || blocked(nj * GCOLS + ci)) continue;
                }
                const step = (dx !== 0 && dy !== 0) ? CELL * 1.41421356 : CELL;
                const ng = g[cur] + step;
                if (ng < g[nn]) {
                    g[nn] = ng;
                    came[nn] = cur;
                    heapPush(open, ng + hFn(nn), nn);
                }
            }
        }
        return null;
    }

    function segClear(ax, ay, bx, by) {
        const d = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.ceil(d / 2));
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const x = ax + (bx - ax) * t;
            const y = ay + (by - ay) * t;
            if (!insideField({ x, y })) return false;
            for (const r of blockRects) {
                if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return false;
            }
        }
        return true;
    }

    function smoothPath(cells) {
        const pts = cells.map(cellCenter);
        if (pts.length <= 2) return pts;
        const out = [pts[0]];
        let i = 0;
        while (i < pts.length - 1) {
            let far = i + 1;
            for (let j = pts.length - 1; j > i + 1; j--) {
                if (segClear(pts[i][0], pts[i][1], pts[j][0], pts[j][1])) {
                    far = j;
                    break;
                }
            }
            out.push(pts[far]);
            i = far;
        }
        return out;
    }

    function buildCharacter(o) {
        const g = el('g', { id: o.id });
        const shadow = el('ellipse', { cx: 0, cy: 0.7, rx: 8, ry: 5.6, fill: 'rgba(0,0,0,0.30)' });
        const footL = el('ellipse', { rx: 1.7, ry: 2.5, fill: '#23272f' });
        const footR = el('ellipse', { rx: 1.7, ry: 2.5, fill: '#23272f' });
        const body = el('g', {});
        const armL = el('ellipse', { cx: -7.3, cy: 0.1, rx: 1.5, ry: 2.6, fill: o.dark });
        const armR = el('ellipse', { cx: 7.3, cy: 0.1, rx: 1.5, ry: 2.6, fill: o.dark });
        const shoulders = el('ellipse', { cx: 0, cy: 0, rx: 7.1, ry: 5, fill: o.shirt, stroke: 'rgba(10,20,40,0.5)', 'stroke-width': 0.35 });
        const highlight = el('ellipse', { cx: -1.7, cy: -1.7, rx: 4, ry: 2.1, fill: 'rgba(255,255,255,0.10)' });
        const collar = el('ellipse', { cx: 0, cy: -4.2, rx: 1.9, ry: 0.9, fill: o.collar });
        const head = el('circle', { cx: 0, cy: -0.8, r: 3.4, fill: '#f1c29a' });
        const hair = el('circle', { cx: 0, cy: o.bald ? 0.5 : -0.6, r: o.bald ? 3.15 : 3.62, fill: '#26201d' });
        const face = el('circle', { cx: 0, cy: o.bald ? -1.7 : -2.45, r: o.bald ? 2.9 : 2.4, fill: '#f1c29a' });
        const shine = o.bald
            ? el('path', { d: 'M -2.0 0.2 A 2.9 2.9 0 0 0 2.0 0.2', fill: 'none', stroke: '#4b3a30', 'stroke-width': 0.5, 'stroke-linecap': 'round' })
            : el('path', { d: 'M -2.1 -1.55 A 2.45 2.45 0 0 1 2.1 -1.55', fill: 'none', stroke: '#4b3a30', 'stroke-width': 0.5, 'stroke-linecap': 'round' });
        const earL = el('circle', { cx: -3.35, cy: -0.4, r: 0.75, fill: '#e8b58d' });
        const earR = el('circle', { cx: 3.35, cy: -0.4, r: 0.75, fill: '#e8b58d' });
        const headG = el('g', {});
        headG.append(head, hair, face, shine, earL, earR);
        body.append(armL, armR, shoulders, highlight, collar, headG);
        let angerG = null;
        if (o.broom) {
            angerG = el('g', { opacity: 0 });
            angerG.append(
                el('ellipse', { cx: 0, cy: 0, rx: 7.1, ry: 5, fill: '#c0392b', 'fill-opacity': 0.55 }),
                el('circle', { cx: 0, cy: o.bald ? -1.7 : -2.45, r: o.bald ? 2.9 : 2.4, fill: '#e74c3c', 'fill-opacity': 0.6 }),
                el('path', { d: 'M 4.5 -4.5 L 7 -2 M 7 -4.5 L 4.5 -2', stroke: '#ff4438', 'stroke-width': 0.8, 'stroke-linecap': 'round', fill: 'none' }),
            );
            body.append(angerG);
        }
        let broom = null;
        if (o.broom) {
            broom = el('g', {});
            broom.append(
                el('line', { x1: 0, y1: 2, x2: 0, y2: -10.8, stroke: '#8a5a2b', 'stroke-width': 1, 'stroke-linecap': 'round' }),
                el('path', { d: 'M -2.4 -11 L 2.4 -11 L 3.2 -15 L -3.2 -15 Z', fill: '#c9a24b', stroke: '#7a5c1d', 'stroke-width': 0.3 }),
                el('line', { x1: -1.4, y1: -11.2, x2: -2.1, y2: -14.6, stroke: '#8a6a1f', 'stroke-width': 0.35 }),
                el('line', { x1: 0, y1: -11.2, x2: 0, y2: -14.8, stroke: '#8a6a1f', 'stroke-width': 0.35 }),
                el('line', { x1: 1.4, y1: -11.2, x2: 2.1, y2: -14.6, stroke: '#8a6a1f', 'stroke-width': 0.35 }),
            );
            broom.setAttribute('transform', 'translate(7.3 -1) rotate(12)');
        }
        g.append(shadow, footL, footR, body);
        if (broom) g.append(broom);
        svg.appendChild(g);
        return { g, body, footL, footR, armL, armR, headG, broom, angerG };
    }

    const player = buildCharacter({ id: 'player', shirt: '#3f5f9e', dark: '#324d80', collar: '#2a4068' });
    const enemyC = buildCharacter({ id: 'enemy', shirt: '#d97a1f', dark: '#9c5313', collar: '#b05f14', bald: true, broom: true });

    const ENEMY_NAME = '/3!F!';
    const nameG = el('g', { id: 'enemy-name' });
    const nameText = el('text', {
        x: 0, y: 0, 'text-anchor': 'middle',
        'font-family': 'Consolas, monospace', 'font-size': 7, 'font-weight': 'bold',
        fill: '#ff9d45', stroke: 'rgba(0,0,0,0.75)', 'stroke-width': 0.9, 'paint-order': 'stroke',
    });
    nameText.textContent = ENEMY_NAME;
    nameG.appendChild(nameText);
    svg.appendChild(nameG);

    const dooG = el('g', { id: 'doodies' });
    svg.insertBefore(dooG, player.g);
    const RING_CIRC = 2 * Math.PI * 11;
    const ringG = el('g', { id: 'doo-ring', visibility: 'hidden' });
    ringG.append(
        el('circle', { cx: 0, cy: 0, r: 11, fill: 'none', stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 1.4 }),
        el('circle', { cx: 0, cy: 0, r: 11, fill: 'none', stroke: '#8a5a2b', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-dasharray': RING_CIRC.toFixed(2), 'stroke-dashoffset': RING_CIRC.toFixed(2) }),
    );
    svg.appendChild(ringG);
    const ringFg = ringG.children[1];

    const BURGER_INTERVAL_SECONDS = 30;
    const BURGER_POS = [269, 128];
    const BURGER_PICKUP_DIST = 12;
    const BURGER_PICKUP_SECONDS = 1;
    const BOWEL_BOOST_SECONDS = 3;
    const burgerLayer = el('g', { id: 'burger-layer' });
    svg.insertBefore(burgerLayer, player.g);
    const burgerRingG = el('g', { id: 'burger-ring', visibility: 'hidden' });
    burgerRingG.append(
        el('circle', { cx: 0, cy: 0, r: 11, fill: 'none', stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 1.4 }),
        el('circle', { cx: 0, cy: 0, r: 11, fill: 'none', stroke: '#ffd27a', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-dasharray': RING_CIRC.toFixed(2), 'stroke-dashoffset': RING_CIRC.toFixed(2) }),
    );
    svg.appendChild(burgerRingG);
    const burgerRingFg = burgerRingG.children[1];
    let burger = null;
    let burgerTimer = BURGER_INTERVAL_SECONDS;
    let bowelBoost = null;

    const RB_POS = [362, 128];
    const RB_PICKUP_DIST = 12;
    const RB_PICKUP_SECONDS = 1;
    const RB_BOOST_SECONDS = 5;
    const RB_FIRST_DELAY = 100; // TODO: back to 100 when done debugging
    const RB_INTERVAL_SECONDS = 30;
    const rbLayer = el('g', { id: 'rb-layer' });
    svg.insertBefore(rbLayer, player.g);
    const rbRingG = el('g', { id: 'rb-ring', visibility: 'hidden' });
    rbRingG.append(
        el('circle', { cx: 0, cy: 0, r: 11, fill: 'none', stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 1.4 }),
        el('circle', { cx: 0, cy: 0, r: 11, fill: 'none', stroke: '#7fb2ff', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-dasharray': RING_CIRC.toFixed(2), 'stroke-dashoffset': RING_CIRC.toFixed(2) }),
    );
    svg.appendChild(rbRingG);
    const rbRingFg = rbRingG.children[1];
    let redbull = null;
    let rbTimer = RB_FIRST_DELAY;
    let redbullStock = 0;
    let rbBoostT = 0;
    let rbL2Prev = false;
    let rbClipSeq = 0;

    const PLAYER_SPAWN = [165, 300];
    const ENEMY_SPAWN = [390, 133];
    const st = {
        x: PLAYER_SPAWN[0], y: PLAYER_SPAWN[1],
        vx: 0, vy: 0,
        angle: 0,
        phase: 0,
        stride: 0,
    };
    const ENEMY = {
        x: ENEMY_SPAWN[0], y: ENEMY_SPAWN[1],
        vx: 0, vy: 0,
        angle: Math.PI,
        phase: 0,
        stride: 0,
        path: [],
        pathI: 0,
        lastPlan: 0,
        lastCell: -1,
        lastProgress: 0,
        broomPhase: 0,
        anger: 0,
        sweep: null,
        trail: null,
    };
    resolve(st);
    resolve(ENEMY);

    const MAX_SPEED = 62;
    const CAPTURE_DIST = 9;
    const BOWEL_WALK_SECONDS = 15;
    const DROODIE_LAY_SECONDS = 3;
    const DOODY_SWEEP_SECONDS = 2;
    const DOODY_TRIGGER_DIST = 11;
    const PLAYER_WIDTH = 14.2;
    const AGGRO_DIST = PLAYER_WIDTH * 5;
    const TRAIL_STEPS = 6;
    const TRAIL_STRIDE = AGGRO_DIST / TRAIL_STEPS;
    let bowel = 0;
    let score = 0;
    const doo = { laying: false, t: 0 };
    const doodies = [];
    const ENEMY_START_SPEED = MAX_SPEED * 0.5;
    const ENEMY_TOP_SPEED = MAX_SPEED * 1.05;
    const ENEMY_RAMP_SECONDS = 180;
    function enemySpeed() {
        const t = Math.max(0, ((overAt || performance.now()) - runStart) / 1000);
        return Math.min(ENEMY_TOP_SPEED, ENEMY_START_SPEED + ((ENEMY_TOP_SPEED - ENEMY_START_SPEED) / ENEMY_RAMP_SECONDS) * t);
    }
    let lastPosLog = 0;
    let lastHud = 0;

    const hudTime = document.getElementById('hud-time');
    const hudEnemy = document.getElementById('hud-enemy');
    const hudScore = document.getElementById('hud-score');
    const totalValue = document.getElementById('total-value');
    const hudPad = document.getElementById('hud-pad');
    const bowelFill = document.getElementById('bowel-fill');
    const bowelHint = document.getElementById('bowel-hint');
    const hudRb = document.getElementById('redbull-count');
    const hudRbBoost = document.getElementById('redbull-boost');
    const overEl = document.getElementById('over');
    const overSub = document.getElementById('over-sub');
    let overAt = 0;
    let runStart = performance.now();
    let padLabel = '';

    const KEYMAP = {
        KeyW: [0, -1], ArrowUp: [0, -1],
        KeyS: [0, 1], ArrowDown: [0, 1],
        KeyA: [-1, 0], ArrowLeft: [-1, 0],
        KeyD: [1, 0], ArrowRight: [1, 0],
    };
    const keys = new Set();
    let spaceHeld = false;
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') { spaceHeld = true; e.preventDefault(); return; }
        if (e.code === 'KeyR') { if (!e.repeat) consumeRedBull(); return; }
        if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') { spaceHeld = false; return; }
        keys.delete(e.code);
    });
    window.addEventListener('blur', () => { keys.clear(); spaceHeld = false; });

    function readGamepad() {
        if (!navigator.getGamepads) return [0, 0, false, 0];
        const pads = navigator.getGamepads();
        for (const p of pads) {
            if (!p || !p.connected) continue;
            let x = p.axes[0] || 0, y = p.axes[1] || 0;
            const dz = 0.25;
            if (Math.abs(x) < dz) x = 0;
            if (Math.abs(y) < dz) y = 0;
            if (p.buttons[12] && p.buttons[12].pressed) y = -1;
            if (p.buttons[13] && p.buttons[13].pressed) y = 1;
            if (p.buttons[14] && p.buttons[14].pressed) x = -1;
            if (p.buttons[15] && p.buttons[15].pressed) x = 1;
            const m = Math.hypot(x, y);
            if (m > 1) { x /= m; y /= m; }
            const r2 = p.buttons[7] && p.buttons[7].value > 0.5 ? 1 : 0;
            const l2 = p.buttons[6] && p.buttons[6].value > 0.5 ? 1 : 0;
            return [x, y, true, r2, l2];
        }
        return [0, 0, false, 0, 0];
    }

    function readInput() {
        let x = 0, y = 0;
        for (const c of keys) {
            const v = KEYMAP[c];
            if (v) { x += v[0]; y += v[1]; }
        }
        const g = readGamepad();
        x += g[0];
        y += g[1];
        const m = Math.hypot(x, y);
        if (m > 1) { x /= m; y /= m; }
        return [x, y];
    }

    function animChar(P, S, speed, dt) {
        if (speed > 4) {
            const target = Math.atan2(S.vy, S.vx) + Math.PI / 2;
            const d = Math.atan2(Math.sin(target - S.angle), Math.cos(target - S.angle));
            S.angle += d * Math.min(1, dt * 10);
        }
        const strideTarget = Math.min(1, speed / 25);
        S.stride += (strideTarget - S.stride) * Math.min(1, dt * 9);
        S.phase += dt * speed * 0.34;

        const s = Math.sin(S.phase), c = Math.cos(S.phase), str = S.stride;
        const fLx = -(5 + 1.5 * str * c);
        const fLy = 0.2 - 2.6 * str * s;
        const fRx = 5 + 1.5 * str * c;
        const fRy = 0.2 + 2.6 * str * s;
        const frot = -14 * str * s;
        P.footL.setAttribute('transform', `translate(${fLx.toFixed(3)} ${fLy.toFixed(3)}) rotate(${frot.toFixed(2)})`);
        P.footR.setAttribute('transform', `translate(${fRx.toFixed(3)} ${fRy.toFixed(3)}) rotate(${frot.toFixed(2)})`);

        P.armL.setAttribute('cy', (0.1 + 1 * str * s).toFixed(3));
        P.armR.setAttribute('cy', (0.1 - 1 * str * s).toFixed(3));

        const bob = 0.3 * str * Math.sin(S.phase * 2);
        const sc = 1 + 0.045 * str * Math.sin(S.phase * 2);
        P.body.setAttribute('transform', `translate(0 ${bob.toFixed(3)}) scale(${sc.toFixed(4)})`);

        P.g.setAttribute('transform', `translate(${S.x.toFixed(3)} ${S.y.toFixed(3)}) rotate(${(S.angle * 180 / Math.PI).toFixed(2)})`);
    }

    function crouchPose(t) {
        const wob = 1 + 0.03 * Math.sin(t * 10);
        player.footL.setAttribute('transform', 'translate(-3.2 0.6)');
        player.footR.setAttribute('transform', 'translate(3.2 0.6)');
        player.armL.setAttribute('cy', '0.6');
        player.armR.setAttribute('cy', '0.6');
        player.body.setAttribute('transform', `translate(0 0.4) scale(${(0.85 * wob).toFixed(4)})`);
        player.headG.setAttribute('transform', 'translate(0 -0.8) scale(1.35) translate(0 0.8)');
        player.g.setAttribute('transform', `translate(${st.x.toFixed(3)} ${st.y.toFixed(3)}) rotate(${(st.angle * 180 / Math.PI).toFixed(2)})`);
    }

    function addDoo(x, y) {
        const g = el('g', { transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(Math.random() * 360).toFixed(0)})` });
        g.append(
            el('ellipse', { cx: 0, cy: 0, rx: 3.4, ry: 2.6, fill: '#6b4a2b', stroke: '#4a3018', 'stroke-width': 0.4 }),
            el('ellipse', { cx: 1.8, cy: -1.2, rx: 2.4, ry: 1.8, fill: '#7a5533', stroke: '#4a3018', 'stroke-width': 0.4 }),
            el('ellipse', { cx: -1.5, cy: 1.4, rx: 2.0, ry: 1.5, fill: '#5d3f24', stroke: '#4a3018', 'stroke-width': 0.4 }),
        );
        dooG.appendChild(g);
        doodies.push({ x, y, g, alive: true, triggered: false });
        score += 50;
    }

    function removeDoo(d) {
        if (!d.alive) return;
        d.alive = false;
        d.g.remove();
    }

    function burgerGraphic() {
        const g = el('g', {});
        g.append(
            el('ellipse', { cx: 0, cy: 0.8, rx: 9.2, ry: 8.4, fill: 'rgba(0,0,0,0.30)' }),
        );
        const glow = el('circle', { cx: 0, cy: 0, r: 12, fill: '#ffd27a', 'fill-opacity': 0.14 });
        g.appendChild(glow);
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            g.appendChild(el('circle', { cx: (Math.cos(a) * 7.6).toFixed(2), cy: (Math.sin(a) * 7.6).toFixed(2), r: 2.7, fill: i % 2 ? '#7fae4a' : '#8cbf54' }));
        }
        g.appendChild(el('circle', { cx: 0, cy: 0, r: 8.3, fill: '#6b4226' }));
        g.appendChild(el('rect', { x: -6.5, y: -6.5, width: 13, height: 13, rx: 2, fill: '#f5b93c', transform: 'rotate(18)' }));
        g.appendChild(el('circle', { cx: 0, cy: 0, r: 7.4, fill: '#d99a3e', stroke: 'rgba(96,52,12,0.55)', 'stroke-width': 0.6 }));
        g.appendChild(el('ellipse', { cx: -1.8, cy: -1.8, rx: 4.2, ry: 2.9, fill: 'rgba(255,255,255,0.14)' }));
        const seeds = [[-3.2, -2.2, 24], [-0.4, -3.6, -18], [2.9, -2.4, 40], [3.6, 0.6, -30], [1.4, 1.6, 12], [-1.9, 0.9, -48], [-4.0, 1.6, 30], [0.2, -0.8, 70], [2.2, -0.4, -8]];
        for (const [sx, sy, sr] of seeds) {
            g.appendChild(el('ellipse', { cx: sx, cy: sy, rx: 0.8, ry: 0.48, fill: '#f7e6b8', transform: `rotate(${sr} ${sx} ${sy})` }));
        }
        const tag = el('text', {
            x: 0, y: -15, 'text-anchor': 'middle',
            'font-family': 'Consolas, monospace', 'font-size': 6, 'font-weight': 'bold',
            fill: '#ffd27a', stroke: 'rgba(0,0,0,0.75)', 'stroke-width': 0.8, 'paint-order': 'stroke',
        });
        tag.textContent = 'x-lan burger';
        g.appendChild(tag);
        return { g, glow };
    }

    function spawnBurger() {
        if (burger) return;
        const wrap = el('g', { transform: `translate(${BURGER_POS[0]} ${BURGER_POS[1]})` });
        const { g: inner, glow } = burgerGraphic();
        wrap.appendChild(inner);
        burgerLayer.appendChild(wrap);
        burger = { g: wrap, inner, glow, hold: 0 };
    }

    function removeBurger() {
        if (!burger) return;
        burger.g.remove();
        burger = null;
    }

    function redBullGraphic() {
        const g = el('g', {});
        g.append(
            el('ellipse', { cx: 0, cy: 1.2, rx: 8.5, ry: 7.5, fill: 'rgba(0,0,0,0.32)' }),
        );
        const glow = el('circle', { cx: 0, cy: 0, r: 13, fill: '#7fb2ff', 'fill-opacity': 0.16 });
        g.appendChild(glow);
        const cpId = 'rb-clip-' + (++rbClipSeq);
        const cp = el('clipPath', { id: cpId });
        cp.appendChild(el('circle', { cx: 0, cy: 0, r: 7.5 }));
        g.appendChild(cp);
        g.appendChild(el('circle', { cx: 0, cy: 0, r: 7.5, fill: '#dfe3e8', stroke: '#838a94', 'stroke-width': 0.5 }));
        const clipped = el('g', { 'clip-path': `url(#${cpId})` });
        clipped.append(
            el('rect', { x: -9, y: -2.6, width: 18, height: 5.2, fill: '#d42027', transform: 'rotate(-24)' }),
            el('circle', { cx: 0, cy: 0, r: 7.5, fill: 'none', stroke: '#d42027', 'stroke-width': 1.8 }),
            el('circle', { cx: 0.4, cy: 0, r: 1.5, fill: '#ffd27a' }),
            el('ellipse', { cx: 0, cy: -4, rx: 1.5, ry: 0.8, fill: '#aab0b8', stroke: '#7d838c', 'stroke-width': 0.3 }),
        );
        g.appendChild(clipped);
        const tag = el('text', {
            x: 0, y: -13, 'text-anchor': 'middle',
            'font-family': 'Consolas, monospace', 'font-size': 6, 'font-weight': 'bold',
            fill: '#9fd0ff', stroke: 'rgba(0,0,0,0.75)', 'stroke-width': 0.8, 'paint-order': 'stroke',
        });
        tag.textContent = 'red-bull';
        g.appendChild(tag);
        return { g, glow };
    }

    function spawnRedBull() {
        if (redbull) return;
        const wrap = el('g', { transform: `translate(${RB_POS[0]} ${RB_POS[1]})` });
        const { g: inner, glow } = redBullGraphic();
        wrap.appendChild(inner);
        rbLayer.appendChild(wrap);
        redbull = { g: wrap, inner, glow, hold: 0 };
    }

    function removeRedBull() {
        if (!redbull) return;
        redbull.g.remove();
        redbull = null;
    }

    function consumeRedBull() {
        if (overAt || redbullStock <= 0) return;
        redbullStock--;
        rbBoostT = RB_BOOST_SECONDS;
    }

function footClear(fx, fy) {
        if (!insideField({ x: fx, y: fy })) return false;
        for (const r of blockRects) {
            const m = PLAYER_R - 2;
            if (fx > r.x + m && fx < r.x + r.w - m && fy > r.y + m && fy < r.y + r.h - m) return false;
        }
        return true;
    }

    function stampFoot(fx, fy, ang, op) {
        score += 5;
        const g = el('g', {
            fill: '#6b4a2b',
            'fill-opacity': op.toFixed(2),
            transform: `translate(${fx.toFixed(2)} ${fy.toFixed(2)}) rotate(${ang.toFixed(1)})`,
        });
        g.append(
            el('ellipse', { cx: 1.3, cy: 0, rx: 1.7, ry: 1.3 }),
            el('ellipse', { cx: -1.7, cy: 0, rx: 1.0, ry: 1.05 }),
        );
        dooG.appendChild(g);
    }

    function planPath() {
        const sc = cellAt(ENEMY.x, ENEMY.y);
        const pc = cellAt(st.x, st.y);
        const cells = astar(sc, pc);
        ENEMY.path = cells ? smoothPath(cells) : [];
        ENEMY.pathI = 0;
        ENEMY.lastPlan = performance.now();
        ENEMY.lastCell = pc;
    }

    function resetGame() {
        st.x = PLAYER_SPAWN[0]; st.y = PLAYER_SPAWN[1];
        st.vx = 0; st.vy = 0; st.angle = 0; st.phase = 0; st.stride = 0;
        ENEMY.x = ENEMY_SPAWN[0]; ENEMY.y = ENEMY_SPAWN[1];
        ENEMY.vx = 0; ENEMY.vy = 0; ENEMY.angle = Math.PI; ENEMY.phase = 0; ENEMY.stride = 0;
        ENEMY.path = [];
        ENEMY.pathI = 0;
        ENEMY.lastPlan = 0;
        ENEMY.lastCell = -1;
        ENEMY.lastProgress = performance.now();
        ENEMY.broomPhase = 0;
        ENEMY.anger = 0;
        ENEMY.sweep = null;
        ENEMY.trail = null;
        bowel = 0;
        doo.laying = false;
        doo.t = 0;
        score = 0;
        doodies.length = 0;
        dooG.replaceChildren();
        ringG.setAttribute('visibility', 'hidden');
        removeBurger();
        burgerTimer = BURGER_INTERVAL_SECONDS;
        bowelBoost = null;
        burgerRingG.setAttribute('visibility', 'hidden');
        removeRedBull();
        rbTimer = RB_FIRST_DELAY;
        redbullStock = 0;
        rbBoostT = 0;
        rbL2Prev = false;
        rbRingG.setAttribute('visibility', 'hidden');
        hudRb.textContent = 'red-bull ×0';
        hudRbBoost.textContent = '';
        hudRbBoost.className = '';
        overAt = 0;
        runStart = performance.now();
        hudTime.textContent = 'time 0.0s';
        hudEnemy.textContent = `${ENEMY_NAME} @ 0.50x`;
        bowelFill.style.height = '0%';
        bowelHint.style.visibility = 'hidden';
        hudScore.textContent = 'score 0';
        totalValue.textContent = '0.0';
        overEl.classList.remove('show');
    }

    function doOver() {
        if (overAt) return;
        overAt = performance.now();
        st.vx = 0; st.vy = 0;
        ENEMY.vx = 0; ENEMY.vy = 0;
        overSub.textContent = `${ENEMY_NAME} got you — survived ${((overAt - runStart) / 1000).toFixed(1)}s · score ${score}`;
        overEl.classList.add('show');
    }

    overEl.addEventListener('click', () => {
        if (!overAt) return;
        resetGame();
    });

    function update(dt) {
        const now = performance.now();
        if (!overAt) {
            if (rbBoostT > 0) rbBoostT = Math.max(0, rbBoostT - dt);
            if (!burger) {
                burgerTimer -= dt;
                if (burgerTimer <= 0) { spawnBurger(); burgerTimer = BURGER_INTERVAL_SECONDS; }
            }
            if (!redbull) {
                rbTimer -= dt;
                if (rbTimer <= 0) { spawnRedBull(); rbTimer = RB_INTERVAL_SECONDS; }
            }
            const k = 1 - Math.exp(-dt * 10);
            if (doo.laying) {
                st.vx += (0 - st.vx) * k;
                st.vy += (0 - st.vy) * k;
                doo.t += dt;
                if (doo.t >= DROODIE_LAY_SECONDS) {
                    doo.laying = false;
                    doo.t = 0;
                    bowel = 0;
                    addDoo(st.x, st.y);
                }
            } else {
                const [ix, iy] = readInput();
                const pMax = rbBoostT > 0 ? MAX_SPEED * 2 : MAX_SPEED;
                st.vx += (ix * pMax - st.vx) * k;
                st.vy += (iy * pMax - st.vy) * k;
                st.x += st.vx * dt;
                st.y += st.vy * dt;
                resolve(st);
                if (Math.hypot(st.vx, st.vy) > 4 && !bowelBoost) {
                    bowel = Math.min(1, bowel + dt / BOWEL_WALK_SECONDS);
                }
                const gp = readGamepad();
                if (bowel >= 1 && (spaceHeld || gp[3])) {
                    doo.laying = true;
                    doo.t = 0;
                    st.vx = 0;
                    st.vy = 0;
                }
            }

            if (burger) {
                const dB = Math.hypot(st.x - BURGER_POS[0], st.y - BURGER_POS[1]);
                burger.hold = dB < BURGER_PICKUP_DIST ? Math.min(BURGER_PICKUP_SECONDS, burger.hold + dt) : 0;
                if (burger.hold >= BURGER_PICKUP_SECONDS) {
                    bowelBoost = { from: bowel, t: 0 };
                    removeBurger();
                }
            }
            if (bowelBoost) {
                bowelBoost.t += dt;
                const bbk = Math.min(1, bowelBoost.t / BOWEL_BOOST_SECONDS);
                bowel = bowelBoost.from + (1 - bowelBoost.from) * bbk;
                if (bowelBoost.t >= BOWEL_BOOST_SECONDS) { bowel = 1; bowelBoost = null; }
            }
            if (redbull) {
                const dR = Math.hypot(st.x - RB_POS[0], st.y - RB_POS[1]);
                redbull.hold = dR < RB_PICKUP_DIST ? Math.min(RB_PICKUP_SECONDS, redbull.hold + dt) : 0;
                if (redbull.hold >= RB_PICKUP_SECONDS) {
                    redbullStock++;
                    removeRedBull();
                }
            }
            const gp2 = readGamepad();
            if (gp2[4] && !rbL2Prev) consumeRedBull();
            rbL2Prev = !!gp2[4];

            const pc = cellAt(st.x, st.y);
            if (now - ENEMY.lastPlan > 400 || pc !== ENEMY.lastCell || ENEMY.path.length === 0) {
                planPath();
            }

            let tx = st.x, ty = st.y;
            if (ENEMY.path.length > 0) {
                if (ENEMY.pathI >= ENEMY.path.length) ENEMY.pathI = ENEMY.path.length - 1;
                const wp = ENEMY.path[ENEMY.pathI];
                tx = wp[0];
                ty = wp[1];
                if (Math.hypot(wp[0] - ENEMY.x, wp[1] - ENEMY.y) < CELL * 0.6) {
                    ENEMY.pathI++;
                }
            }
            if (!ENEMY.sweep) {
                let nearDoo = null, nearD = Infinity;
                for (const d of doodies) {
                    if (!d.alive || d.triggered) continue;
                    const dd = Math.hypot(d.x - ENEMY.x, d.y - ENEMY.y);
                    if (dd < DOODY_TRIGGER_DIST && dd < nearD) { nearDoo = d; nearD = dd; }
                }
                if (nearDoo) {
                    const dPlayer = Math.hypot(st.x - ENEMY.x, st.y - ENEMY.y);
                    if (dPlayer <= AGGRO_DIST) {
                        const tdx = tx - ENEMY.x, tdy = ty - ENEMY.y;
                        const tdl = Math.hypot(tdx, tdy) || 1;
                        stampFoot(nearDoo.x, nearDoo.y, Math.atan2(tdy, tdx) * 180 / Math.PI - 7, 0.9);
                        nearDoo.triggered = true;
                        ENEMY.trail = { left: TRAIL_STEPS - 1, dist: 0, side: 1, dirX: tdx / tdl, dirY: tdy / tdl };
                    } else {
                        ENEMY.sweep = { t: 0, doody: nearDoo };
                    }
                }
            }
            let ex = 0, ey = 0;
            if (ENEMY.sweep) {
                ENEMY.sweep.t += dt;
                if (ENEMY.sweep.t >= DOODY_SWEEP_SECONDS) {
                    removeDoo(ENEMY.sweep.doody);
                    score -= 50;
                    ENEMY.sweep = null;
                }
            } else {
                const dx = tx - ENEMY.x, dy = ty - ENEMY.y;
                const dl = Math.hypot(dx, dy);
                if (dl > 0.001) { ex = dx / dl; ey = dy / dl; }
            }
            const eMax = enemySpeed();
            ENEMY.vx += (ex * eMax - ENEMY.vx) * k;
            ENEMY.vy += (ey * eMax - ENEMY.vy) * k;
            const epx = ENEMY.x, epy = ENEMY.y;
            ENEMY.x += ENEMY.vx * dt;
            ENEMY.y += ENEMY.vy * dt;
            resolve(ENEMY);
            if (ENEMY.trail) {
                const tr = ENEMY.trail;
                const mv = Math.hypot(ENEMY.x - epx, ENEMY.y - epy);
                if (mv > 0.01) {
                    tr.dirX = (ENEMY.x - epx) / mv;
                    tr.dirY = (ENEMY.y - epy) / mv;
                    tr.dist += mv;
                }
                if (tr.left > 0 && tr.dist >= TRAIL_STRIDE) {
                    tr.dist = Math.min(tr.dist - TRAIL_STRIDE, TRAIL_STRIDE);
                    const idx = TRAIL_STEPS - tr.left;
                    const fx = ENEMY.x - tr.dirY * tr.side * 3.4;
                    const fy = ENEMY.y + tr.dirX * tr.side * 3.4;
                    if (footClear(fx, fy)) {
                        stampFoot(fx, fy, Math.atan2(tr.dirY, tr.dirX) * 180 / Math.PI + tr.side * 7, 0.9 - idx * 0.12);
                    }
                    tr.side = -tr.side;
                    tr.left--;
                    if (tr.left === 0) ENEMY.trail = null;
                }
            }

            const dPlayer = Math.hypot(st.x - ENEMY.x, st.y - ENEMY.y);
            const targetAnger = dPlayer <= AGGRO_DIST ? 1 : 0;
            ENEMY.anger += (targetAnger - ENEMY.anger) * Math.min(1, dt * 4);
            enemyC.angerG.setAttribute('opacity', ENEMY.anger.toFixed(3));

            const espeed = Math.hypot(ENEMY.vx, ENEMY.vy);
            if (espeed > 5) {
                ENEMY.lastProgress = now;
            } else if (ENEMY.path.length > 0 && now - ENEMY.lastProgress > 1500) {
                planPath();
            }

            if (Math.hypot(ENEMY.x - st.x, ENEMY.y - st.y) < CAPTURE_DIST) {
                doOver();
            }
        }

        const pspeed = Math.hypot(st.vx, st.vy);
        if (doo.laying) {
            crouchPose(doo.t);
            ringG.setAttribute('visibility', 'visible');
            ringG.setAttribute('transform', `translate(${st.x.toFixed(2)} ${st.y.toFixed(2)}) rotate(-90)`);
            ringFg.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - Math.min(1, doo.t / DROODIE_LAY_SECONDS))).toFixed(2));
        } else {
            animChar(player, st, pspeed, dt);
            player.headG.setAttribute('transform', '');
            ringG.setAttribute('visibility', 'hidden');
        }
        if (burger && burger.hold > 0 && !doo.laying) {
            burgerRingG.setAttribute('visibility', 'visible');
            burgerRingG.setAttribute('transform', `translate(${st.x.toFixed(2)} ${st.y.toFixed(2)}) rotate(-90)`);
            burgerRingFg.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - Math.min(1, burger.hold / BURGER_PICKUP_SECONDS))).toFixed(2));
        } else {
            burgerRingG.setAttribute('visibility', 'hidden');
        }
        if (burger) {
            const bp = now * 0.004;
            burger.inner.setAttribute('transform', `scale(${(1 + 0.035 * Math.sin(bp)).toFixed(4)})`);
            burger.glow.setAttribute('fill-opacity', (0.14 + 0.07 * Math.sin(bp * 0.8)).toFixed(3));
        }
        if (redbull && redbull.hold > 0 && !doo.laying) {
            rbRingG.setAttribute('visibility', 'visible');
            rbRingG.setAttribute('transform', `translate(${st.x.toFixed(2)} ${st.y.toFixed(2)}) rotate(-90)`);
            rbRingFg.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - Math.min(1, redbull.hold / RB_PICKUP_SECONDS))).toFixed(2));
        } else {
            rbRingG.setAttribute('visibility', 'hidden');
        }
        if (redbull) {
            const rp = now * 0.004;
            redbull.inner.setAttribute('transform', `scale(${(1 + 0.035 * Math.sin(rp)).toFixed(4)})`);
            redbull.glow.setAttribute('fill-opacity', (0.14 + 0.07 * Math.sin(rp * 0.8)).toFixed(3));
        }
        const espeed = Math.hypot(ENEMY.vx, ENEMY.vy);
        animChar(enemyC, ENEMY, espeed, dt);
        if (enemyC.angerG) {
            enemyC.angerG.setAttribute('opacity', ENEMY.anger.toFixed(3));
        }

        if (enemyC.broom) {
            const sweeping = !!ENEMY.sweep;
            const chase = Math.min(1, espeed / 20);
            const amp = 14 + 6 * ENEMY.anger;
            if (!overAt) {
                ENEMY.broomPhase += dt * (sweeping ? 6 : 4 + espeed * 0.25 + ENEMY.anger * 1.5);
            }
            const shake = Math.sin(ENEMY.broomPhase) * amp * (sweeping ? 1 : chase);
            enemyC.broom.setAttribute('transform', `translate(7.3 -1) rotate(${(12 + shake).toFixed(2)})`);
        }

        if (pspeed > 0.5) {
            if (now - lastPosLog > 100) {
                lastPosLog = now;
                console.log(`[player] x=${st.x.toFixed(1)} y=${st.y.toFixed(1)}`);
            }
        }

        nameG.setAttribute('transform', `translate(${ENEMY.x.toFixed(2)} ${(ENEMY.y - 15).toFixed(2)})`);

        if (now - lastHud > 100) {
            lastHud = now;
            hudTime.textContent = `time ${(((overAt || now) - runStart) / 1000).toFixed(1)}s`;
            hudEnemy.textContent = `${ENEMY_NAME} @ ${(enemySpeed() / MAX_SPEED).toFixed(2)}x`;
            hudScore.textContent = `score ${score}`;
            totalValue.textContent = (score + 0.5 * ((overAt || now) - runStart) / 1000).toFixed(1);
            bowelFill.style.height = `${(bowel * 100).toFixed(1)}%`;
            bowelFill.classList.toggle('full', bowel >= 1);
            bowelHint.style.visibility = bowel >= 1 ? 'visible' : 'hidden';
            hudRb.textContent = `red-bull ×${redbullStock}`;
            if (rbBoostT > 0) {
                hudRbBoost.textContent = `×2 speed ${rbBoostT.toFixed(1)}s`;
                hudRbBoost.className = 'active';
            } else if (redbullStock > 0) {
                hudRbBoost.textContent = 'R / L2 to chug';
                hudRbBoost.className = 'ready';
            } else {
                hudRbBoost.textContent = '';
                hudRbBoost.className = '';
            }
        }

        const g = readGamepad();
        const label = g[2] ? 'controller: connected' : 'controller: none';
        if (label !== padLabel) {
            padLabel = label;
            if (hudPad) hudPad.textContent = label;
        }
    }

    window.addEventListener('resize', () => {
        readObstacles();
        rebuildGrid();
    });

    readObstacles();
    rebuildGrid();
    ENEMY.lastProgress = performance.now();
    let last = performance.now();
    function frame(now) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (obstacles.length === 0) {
            readObstacles();
            rebuildGrid();
        }
        update(dt);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    window.__game = {
        get obstacleCount() { return obstacles.length; },
        get obstacles() { return obstacles; },
        get field() { return FIELD; },
        get grid() { return { cols: GCOLS, rows: GROWS, blocked: grid.blocked }; },
        get blockRects() { return blockRects; },
        get state() { return { x: st.x, y: st.y, angle: st.angle, stride: st.stride, speed: Math.hypot(st.vx, st.vy) }; },
        get enemy() {
            return {
                name: ENEMY_NAME,
                x: ENEMY.x, y: ENEMY.y, angle: ENEMY.angle,
                speed: Math.hypot(ENEMY.vx, ENEMY.vy),
                maxSpeed: enemySpeed(),
                pathLen: ENEMY.path.length,
                path: ENEMY.path,
                over: !!overAt,
                anger: ENEMY.anger,
                sweeping: !!ENEMY.sweep,
            };
        },
        get score() { return score; },
        get total() { return +(score + 0.5 * ((overAt || performance.now()) - runStart) / 1000).toFixed(1); },
        get bowel() { return bowel; },
        setBowel: (v) => { bowel = Math.max(0, Math.min(1, v)); },
        get bowelBoost() { return bowelBoost ? { from: bowelBoost.from, t: bowelBoost.t } : null; },
        get burger() { return burger ? { x: BURGER_POS[0], y: BURGER_POS[1], hold: burger.hold } : null; },
        get burgerTimer() { return burgerTimer; },
        spawnBurger: () => spawnBurger(),
        removeBurger: () => removeBurger(),
        get redBull() { return redbull ? { x: RB_POS[0], y: RB_POS[1], hold: redbull.hold } : null; },
        get redBullStock() { return redbullStock; },
        get redBullTimer() { return rbTimer; },
        get rbBoost() { return rbBoostT; },
        spawnRedBull: () => spawnRedBull(),
        removeRedBull: () => removeRedBull(),
        consumeRedBull: () => consumeRedBull(),
        get doo() { return { laying: doo.laying, t: doo.t }; },
        get dooCount() { return dooG.childElementCount; },
        get doodyCount() { return doodies.filter((d) => d.alive).length; },
        get doodyList() { return doodies.filter((d) => d.alive).map((d) => [d.x, d.y]); },
        get trail() { const t = ENEMY.trail; return t ? { left: t.left, idx: TRAIL_STEPS - t.left, dist: +t.dist.toFixed(1) } : null; },
        get angerOpacity() { return enemyC.angerG ? enemyC.angerG.getAttribute('opacity') : null; },
        spawnDoo: (x, y) => addDoo(x, y),
        teleport: {
            player: (x, y) => { st.x = x; st.y = y; st.vx = 0; st.vy = 0; resolve(st); },
            enemy: (x, y) => { ENEMY.x = x; ENEMY.y = y; ENEMY.vx = 0; ENEMY.vy = 0; resolve(ENEMY); },
        },
        restart: resetGame,
    };
})();