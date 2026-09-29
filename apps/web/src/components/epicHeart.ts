/**
 * The card heart, hearted (trip redesign 8a, owner 29 Sep 2026).
 *
 * When a place is hearted onto the shortlist the solid heart pops, a copy flies
 * in an arc to the Shortlist button, and the button bumps as it lands. It is the
 * one flourish that says "it went there" without opening anything — the design's
 * `epic-heart.js`, ported to the app's DOM. Web only (it reaches for the Web
 * Animations API and the frame's real geometry); on native the caller simply
 * does not pass a frame, and nothing animates. Removing a heart has no animation.
 *
 * The chip must contain the flown heart's twin as `[data-ov]`, the Shortlist
 * button carries `[data-fly-to]` on the heart the copy lands on, and `frame` is
 * the element the copy is drawn inside (the phone frame, so it is clipped to it).
 */
const LIME = '#C8F542';
const HEART_PATH = 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z';

type El = Element & { animate?: (kf: Keyframe[], opts: KeyframeAnimationOptions) => Animation };

const canAnimate = (el: unknown): el is El =>
  typeof document !== 'undefined' && !!el && typeof (el as El).animate === 'function' && !prefersReducedMotion();

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The Shortlist button's bump as the heart lands: 1 → 1.07 → 1 over 380ms. */
function bump(target: Element | null | undefined) {
  const t = target as El | null | undefined;
  if (canAnimate(t)) t!.animate!([{ transform: 'scale(1)' }, { transform: 'scale(1.07)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
}

/**
 * Play the heart flying to the shortlist. `chip` is the round card-heart chip
 * that was tapped; `frame` and `target` are the phone frame and the Shortlist
 * button. With no frame or target (native, or no button on screen) it pops in
 * place and bumps nothing.
 */
export function flyHeart(chip: Element, opts: { frame?: Element | null; target?: Element | null; color?: string } = {}): void {
  if (!canAnimate(chip)) return;
  const color = opts.color || LIME;
  const ov = chip.querySelector('[data-ov]') as El | null;
  // The solid heart pops: 0.3 → 1.35 → 0.9 → 1 over 480ms.
  if (canAnimate(ov)) ov!.animate!([
    { transform: 'scale(.3)' }, { transform: 'scale(1.35)', offset: 0.5 }, { transform: 'scale(.9)', offset: 0.78 }, { transform: 'scale(1)' },
  ], { duration: 480, easing: 'ease-out' });

  const frame = opts.frame as El | null | undefined;
  const target = opts.target as El | null | undefined;
  if (!frame || !target) { bump(target); return; }

  const F = frame.getBoundingClientRect();
  const scale = F.width / ((frame as HTMLElement).offsetWidth || F.width) || 1;
  const c = chip.getBoundingClientRect();
  const tEl = (target.querySelector('[data-fly-to]') as Element | null) || target;
  const t = tEl.getBoundingClientRect();
  const x0 = (c.left + c.width / 2 - F.left) / scale, y0 = (c.top + c.height / 2 - F.top) / scale;
  const x1 = (t.left + t.width / 2 - F.left) / scale, y1 = (t.top + t.height / 2 - F.top) / scale;

  const f = document.createElement('div');
  f.setAttribute('aria-hidden', 'true');
  f.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"><path d="${HEART_PATH}"/></svg>`;
  Object.assign(f.style, {
    position: 'absolute', left: `${x0 - 11}px`, top: `${y0 - 11}px`, width: '22px', height: '22px',
    zIndex: '50', pointerEvents: 'none', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))',
  } as CSSStyleDeclaration);
  frame.appendChild(f);

  // A quadratic arc that lifts above both ends and scales up mid-flight.
  const dx = x1 - x0, dy = y1 - y0, cx = dx * 0.35, cy = Math.min(dy, 0) - 70;
  const kf: Keyframe[] = [];
  for (let i = 0; i <= 10; i += 1) {
    const u = i / 10;
    const x = 2 * (1 - u) * u * cx + u * u * dx;
    const y = 2 * (1 - u) * u * cy + u * u * dy;
    kf.push({ transform: `translate(${x}px,${y}px) scale(${1 + 0.3 * Math.sin(u * Math.PI) - 0.35 * u})` });
  }
  const anim = f.animate!(kf, { duration: 720, delay: 120, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'both' });
  anim.onfinish = () => { f.remove(); bump(target); };
}
