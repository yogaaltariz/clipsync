export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android Phone';
  if (/iphone|ipad/i.test(ua)) return 'iPhone';
  if (/mac/i.test(ua)) return 'Mac';
  return 'This Device';
}
