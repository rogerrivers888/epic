/**
 * What to say when the browser will not share where the phone is.
 *
 * Owner, 12 Sep 2026: "if you don't have permission to check location, then
 * it should prompt me: 'You haven't set the permissions. Please give me
 * permission.' This is where you need to go and what you need to do."
 *
 * A browser that has been told no once will not ask again on our behalf, so
 * the only honest thing is to say so and point at the setting. Which setting
 * depends on the device, and on whether Epic is running inside Safari or as
 * an app on the home screen — they are different switches on an iPhone.
 */
export type Device = 'iphone' | 'android' | 'desktop';

export function deviceFrom(userAgent: string): Device {
  const ua = userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iphone';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/** Where to go and what to do, in one paragraph, for the device in hand. */
export function howToAllow(device: Device, standalone = false): string {
  const lead = "You haven't given Epic permission to use your location. ";
  if (device === 'iphone') {
    if (standalone) {
      return `${lead}Open the iPhone's Settings, find Epic in the list of apps, tap Location and choose While Using the App. Then come back and tap Try again.`;
    }
    return `${lead}Tap the AA at the left of the address bar, choose Website Settings, and set Location to Allow. If Location is greyed out, open Settings › Privacy & Security › Location Services › Safari Websites and choose While Using the App. Then tap Try again.`;
  }
  if (device === 'android') {
    return `${lead}Tap the lock or tune icon at the left of the address bar, choose Permissions, and turn Location on. If it is missing, open the phone's Settings › Apps › Chrome › Permissions › Location and choose Allow. Then tap Try again.`;
  }
  return `${lead}Click the icon at the left of the address bar and allow Location for this site, then click Try again.`;
}
