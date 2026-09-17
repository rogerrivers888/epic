import { useCallback, useEffect, useState } from 'react';
import {
  AdminThemePref, applyTheme, getAdminThemePref, resolveTheme, setAdminThemePref,
} from '../theme';

/**
 * Hold the back office's own palette for as long as the back office is on
 * screen, and give the app's back when you leave.
 *
 * The owner, 17 Sep 2026: "pin the back office to dark, please, but I may want
 * to toggle it, so retain the ability to switch." Dark is the default; the
 * choice is remembered; `follow` means whatever the household app is set to.
 */
export function useAdminTheme(): { pref: AdminThemePref; setPref: (p: AdminThemePref) => void } {
  const [pref, setPrefState] = useState<AdminThemePref>(getAdminThemePref());
  useEffect(() => {
    applyTheme(pref === 'follow' ? resolveTheme() : pref);
    // Leaving the back office hands the palette back to the app, whatever the
    // back office was set to: the two are different preferences and the app's
    // is the one that outlives this screen.
    return () => applyTheme(resolveTheme());
  }, [pref]);
  const setPref = useCallback((p: AdminThemePref) => { setAdminThemePref(p); setPrefState(p); }, []);
  return { pref, setPref };
}
