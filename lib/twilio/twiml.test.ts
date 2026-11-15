import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dialTwiml, forwardTwiml, playTwiml, rejectTwiml } from './twiml';

describe('twiml', () => {
  const original = process.env.APP_URL;
  beforeEach(() => {
    process.env.APP_URL = 'https://example.com';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = original;
  });

  it('dialTwiml records, times out, and sets caller id', () => {
    const xml = dialTwiml({ to: '+18045550100', callerId: '+18045550199', callId: 'abc', ringTimeoutS: 25 });
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain('timeout="25"');
    expect(xml).toContain('callerId="+18045550199"');
    expect(xml).toContain('<Number statusCallbackEvent="initiated ringing answered completed"');
    expect(xml).toContain('https://example.com/api/twilio/recording?callId=abc');
    expect(xml).toContain('https://example.com/api/twilio/status?callId=abc&amp;leg=dial');
    expect(xml).toContain('https://example.com/api/twilio/status?callId=abc&amp;leg=child');
    expect(xml).toContain('>+18045550100</Number>');
  });

  it('dialTwiml XML-escapes & in APP_URL', () => {
    process.env.APP_URL = 'https://example.com/?a=1&b=2';
    const xml = dialTwiml({ to: '+18045550100', callerId: '+18045550199', callId: 'abc', ringTimeoutS: 25 });
    expect(xml).toContain('a=1&amp;b=2');
    expect(xml).not.toMatch(/&(?!amp;)/);
  });

  it('rejectTwiml says the reason and hangs up', () => {
    const xml = rejectTwiml('vendor_dnc');
    expect(xml).toContain('<Hangup/>');
    expect(xml).toContain('<Say>Blocked:');
  });

  it('forwardTwiml dials the cell with the original caller as caller id', () => {
    expect(forwardTwiml({ to: '+18045550100', callerId: '+18045550123' })).toBe(
      '<Response><Dial callerId="+18045550123">+18045550100</Dial></Response>',
    );
  });

  it('playTwiml XML-escapes the signed URL and hangs up', () => {
    const xml = playTwiml('https://x.test/a.mp3?token=1&e=2');
    expect(xml).toBe('<Response><Play>https://x.test/a.mp3?token=1&amp;e=2</Play><Hangup/></Response>');
  });
});
