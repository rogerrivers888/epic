import { storage } from './storage';

// Admin mode (owner, 3 Sep 2026): the owner wants to see which source every
// record came from and filter by it, to judge each provider's data before
// paying for it. Households never see this; it is a switch in Settings ›
// Sources kept on this device only. Nothing here changes what the API does.
export const ADMIN_KEY = 'epic.admin';
export const isAdmin = () => storage.getItem(ADMIN_KEY) === 'on';
export const setAdmin = (on: boolean) => { storage.setItem(ADMIN_KEY, on ? 'on' : 'off'); };
