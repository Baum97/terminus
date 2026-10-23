// Brücke zur Android-App (Capacitor). Im Browser ist isNative false und Native null.
const Cap = window.Capacitor;
export const isNative = Boolean(Cap?.isNativePlatform?.());
export const Native = isNative ? Cap.registerPlugin('Terminus') : null;
