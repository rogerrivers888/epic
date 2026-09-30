/**
 * Confetti — the opener's burst (Welcome screens, 1h-0).
 *
 * A canvas particle system on the web (`Confetti.web.tsx`), and nothing on
 * native: the opener is reviewed in the browser and the phone frame, and a
 * canvas is a web thing. The shape is the same either way so the opener can
 * hold a ref and call `burst` without caring which platform it is on; on native
 * the call is a no-op and the screen simply holds its final state.
 */
import React from 'react';

export type ConfettiHandle = {
  /** A burst of `opts.n` pieces from (x, y), given in the 390×844 design space. */
  burst: (x: number, y: number, opts: BurstOpts) => void;
  /** Clear everything and stop the loop. */
  reset: () => void;
};

export type BurstOpts = {
  n?: number;
  colors: string[];
  shapes: ('rect' | 'dot' | 'pin')[];
  power?: number;
  angle?: number;
  spread?: number;
  size?: number;
  g?: number;
  drag?: number;
  life?: number;
};

export const Confetti = React.forwardRef<ConfettiHandle, { width: number; height: number }>(
  function Confetti(_props, ref) {
    React.useImperativeHandle(ref, () => ({ burst: () => {}, reset: () => {} }), []);
    return null;
  },
);
