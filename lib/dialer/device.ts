import type { Device } from '@twilio/voice-sdk';

export type DeviceCtor = new (token: string, options?: Device.Options) => Device;

/**
 * The Twilio Voice Device constructor: the global one when a page has already
 * loaded the SDK as `window.Twilio`, otherwise the bundled npm package.
 */
export async function loadDeviceCtor(): Promise<DeviceCtor> {
  const globalCtor = (window as unknown as { Twilio?: { Device?: DeviceCtor } }).Twilio?.Device;
  if (globalCtor) return globalCtor;
  return (await import('@twilio/voice-sdk')).Device;
}
