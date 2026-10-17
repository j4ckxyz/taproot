import { edgePath, type Layout } from '@shared/layout';

// Spring-driven layout motion for the canvas. When the layout changes, every card springs
// from where it is drawn now to its new place, so neighbours visibly make room. Positions are
// written straight to the SVG elements each frame; React only renders when data changes.

/** Position spring: quick, with a visible but small overshoot (damping ratio ~0.63). */
const POS = { k: 640, c: 32 };
/** Scale spring: bouncier (damping ratio ~0.4), for pops. */
const SCALE = { k: 780, c: 22 };
const REST = 0.05;
const STEP = 1 / 240;

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  vs: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  moving: boolean;
}

interface EdgeRef {
  from: string;
  kind: 'row' | 'column';
  el: SVGPathElement | null;
}

type Follower = { id: string; el: HTMLElement | SVGElement; mode: 'svg' | 'html' };

export class Motion {
  private bodies = new Map<string, Body>();
  private els = new Map<string, SVGGElement>();
  private edges = new Map<string, EdgeRef>();
  private edgeEls = new Map<string, SVGPathElement>();
  private followers = new Set<Follower>();
  private raf = 0;
  private last = 0;
  private seeded = false;
  private ghosts: SVGGElement | null = null;
  enabled = true;
  /** Current zoom, for followers positioned in screen pixels. */
  scale = () => 1;

  /** Layer that removed cards and edges fade out in. */
  setGhostLayer(el: SVGGElement | null) {
    this.ghosts = el;
  }

  registerNode(id: string, el: SVGGElement | null) {
    if (!el) {
      const old = this.els.get(id);
      this.els.delete(id);
      if (old) this.exit(old, 170, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.55)', opacity: 0 }]);
      return;
    }
    this.els.set(id, el);
    const b = this.bodies.get(id);
    if (b) this.writeNode(id, b, el);
  }

  registerEdge(to: string, el: SVGPathElement | null) {
    if (!el) {
      const old = this.edgeEls.get(to);
      this.edgeEls.delete(to);
      if (old) this.exit(old, 140, [{ opacity: 1 }, { opacity: 0 }]);
      return;
    }
    this.edgeEls.set(to, el);
    this.writeEdge(to);
  }

  /** Keep an element glued to a card while it moves (selection handles, the text editor). */
  follow(id: string, el: HTMLElement | SVGElement, mode: 'svg' | 'html'): () => void {
    const f = { id, el, mode };
    this.followers.add(f);
    this.writeFollower(f);
    return () => this.followers.delete(f);
  }

  /** New targets from a fresh layout. Call before paint (in a layout effect). */
  update(layout: Layout, parentOf: (id: string) => string | null) {
    const animate = this.enabled && this.seeded;
    for (const box of layout.boxes.values()) {
      let b = this.bodies.get(box.id);
      if (!b) {
        const pid = parentOf(box.id);
        const p = animate && pid ? this.bodies.get(pid) : undefined;
        // New cards grow out of their parent's centre.
        b = p
          ? { x: p.x + p.w / 2 - box.w / 2, y: p.y + p.h / 2 - box.h / 2, vx: 0, vy: 0, s: 0.35, vs: 0, tx: 0, ty: 0, w: 0, h: 0, moving: true }
          : { x: box.x, y: box.y, vx: 0, vy: 0, s: 1, vs: 0, tx: 0, ty: 0, w: 0, h: 0, moving: false };
        this.bodies.set(box.id, b);
      }
      b.tx = box.x;
      b.ty = box.y;
      b.w = box.w;
      b.h = box.h;
      if (!animate) {
        b.x = box.x;
        b.y = box.y;
        b.vx = b.vy = b.vs = 0;
        b.s = 1;
        b.moving = false;
      } else if (b.x !== b.tx || b.y !== b.ty || b.s !== 1) b.moving = true;
    }
    for (const id of this.bodies.keys()) if (!layout.boxes.has(id)) this.bodies.delete(id);
    this.edges.clear();
    for (const e of layout.edges) this.edges.set(e.to, { from: e.from, kind: e.kind, el: null });
    this.seeded = true;
    this.writeAll();
    if (animate) this.start();
  }

  /** A springy pop, e.g. when something is checked off. */
  kick(id: string, impulse = 3.2) {
    const b = this.bodies.get(id);
    if (!b || !this.enabled) return;
    b.vs += impulse;
    b.moving = true;
    this.start();
  }

  /** Leave a copy of a removed element behind and shrink or fade it away. */
  private exit(el: SVGElement, duration: number, keyframes: Keyframe[]) {
    const layer = this.ghosts;
    if (!this.enabled || !this.seeded || !layer?.isConnected || typeof Element.prototype.animate !== 'function') return;
    const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrap.style.transformBox = 'fill-box';
    wrap.style.transformOrigin = 'center';
    wrap.appendChild(el.cloneNode(true));
    layer.appendChild(wrap);
    wrap.animate(keyframes, { duration, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).onfinish = () => wrap.remove();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private start() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const moved = new Set<string>();
    for (const [id, b] of this.bodies) {
      if (!b.moving) continue;
      let t = dt;
      while (t > 0) {
        const h = Math.min(STEP, t);
        t -= h;
        b.vx += (POS.k * (b.tx - b.x) - POS.c * b.vx) * h;
        b.vy += (POS.k * (b.ty - b.y) - POS.c * b.vy) * h;
        b.vs += (SCALE.k * (1 - b.s) - SCALE.c * b.vs) * h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        b.s += b.vs * h;
      }
      if (
        Math.abs(b.tx - b.x) < REST &&
        Math.abs(b.ty - b.y) < REST &&
        Math.abs(b.vx) < REST * 10 &&
        Math.abs(b.vy) < REST * 10 &&
        Math.abs(1 - b.s) < 0.002 &&
        Math.abs(b.vs) < 0.02
      ) {
        b.x = b.tx;
        b.y = b.ty;
        b.s = 1;
        b.vx = b.vy = b.vs = 0;
        b.moving = false;
      }
      moved.add(id);
    }
    for (const id of moved) {
      const el = this.els.get(id);
      if (el) this.writeNode(id, this.bodies.get(id)!, el);
    }
    for (const [to, e] of this.edges) if (moved.has(to) || moved.has(e.from)) this.writeEdge(to);
    for (const f of this.followers) if (moved.has(f.id)) this.writeFollower(f);
    dt = 0;
    if ([...this.bodies.values()].some((b) => b.moving)) this.raf = requestAnimationFrame(this.tick);
  };

  private writeAll() {
    for (const [id, el] of this.els) {
      const b = this.bodies.get(id);
      if (b) this.writeNode(id, b, el);
    }
    for (const to of this.edges.keys()) this.writeEdge(to);
    for (const f of this.followers) this.writeFollower(f);
  }

  private writeNode(_id: string, b: Body, el: SVGGElement) {
    const r = (n: number) => Math.round(n * 100) / 100;
    if (b.s === 1) el.setAttribute('transform', `translate(${r(b.x)} ${r(b.y)})`);
    else {
      // Scale about the card's centre.
      const s = Math.max(0, b.s);
      el.setAttribute('transform', `translate(${r(b.x + (b.w / 2) * (1 - s))} ${r(b.y + (b.h / 2) * (1 - s))}) scale(${r(s)})`);
    }
  }

  private writeEdge(to: string) {
    const e = this.edges.get(to);
    const el = this.edgeEls.get(to);
    const c = this.bodies.get(to);
    const p = e && this.bodies.get(e.from);
    if (!e || !el || !c || !p) return;
    el.setAttribute('d', edgePath(e.kind, p, c));
  }

  private writeFollower(f: Follower) {
    const b = this.bodies.get(f.id);
    if (!b) return;
    if (f.mode === 'svg') f.el.setAttribute('transform', `translate(${b.x} ${b.y})`);
    else {
      const k = this.scale();
      const el = f.el as HTMLElement;
      el.style.transformOrigin = 'center';
      el.style.transform = `translate(${(b.x - b.tx) * k}px, ${(b.y - b.ty) * k}px) scale(${Math.max(0, b.s)})`;
    }
  }
}
