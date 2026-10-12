import { expect, test } from 'bun:test';
import { decodeCommand } from './protocol';

const id = 'c49f7954-7aab-47f9-a269-752932556c37';
const sdp = 'v=0\r\no=fixture-offer\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

test('each action decodes its own validated input once, and anything else is invalid', () => {
  expect(decodeCommand('start', { id, planId: 'plan', voiceId: 'riley', sdp })).toEqual({ action: 'start', input: { id, planId: 'plan', voiceId: 'riley', sdp } });
  expect(decodeCommand('submitText', { id, text: ' Hello. ' })).toEqual({ action: 'submitText', input: { id, text: ' Hello. ' } });
  expect(decodeCommand('resume', { sdp })).toEqual({ action: 'resume', input: { sdp } });
  for (const [action, body] of [
    ['start', { id, planId: 'plan', voiceId: 'riley', sdp: 'v=0\r\nm=video 9\r\n' }],
    ['start', { id: 'not-a-uuid', planId: 'plan', voiceId: 'riley', sdp }],
    ['submitText', { id, text: '  \n ' }],
    ['submitText', { id, text: 'x'.repeat(2001) }],
    ['submitText', { id, text: 'Hello.', extra: true }],
    ['submitText', undefined],
    ['resume', { sdp: 'short' }],
    ['resume', undefined],
    ['report', {}],
    ['', undefined],
  ] as const) expect(decodeCommand(action, body)).toEqual({ action: 'invalid' });
});

test('activity rides on poll, ready, end and pause: optional, validated, with unreadable diagnostics dropped', () => {
  for (const action of ['poll', 'ready', 'end', 'pause'] as const) {
    expect(decodeCommand(action, undefined)).toEqual({ action });
    expect(decodeCommand(action, { active: true, audio: false, sequence: 3, composing: true })).toEqual({ action, activity: { active: true, audio: false, sequence: 3, composing: true } });
    // The command stays valid when only its diagnostics are unreadable; a malformed report itself does not.
    expect(decodeCommand(action, { active: false, audio: false, network: { ms: 'soon' }, media: 'nope' })).toEqual({ action, activity: { active: false, audio: false } });
    expect(decodeCommand(action, { active: false })).toEqual({ action: 'invalid' });
    expect(decodeCommand(action, { active: false, audio: false, extra: 1 })).toEqual({ action: 'invalid' });
    expect(decodeCommand(action, null)).toEqual({ action: 'invalid' });
  }
});
