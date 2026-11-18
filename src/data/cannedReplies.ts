/** Saved replies for the composer's "/" menu (Zendesk-style macros). {first} is replaced with the requester's first name. */
export interface CannedReply {
  id: string;
  label: string;
  body: string;
}

export const CANNED_REPLIES: CannedReply[] = [
  { id: 'ack', label: 'Acknowledge & set expectations', body: "Hi {first}, thanks for reaching out — I'm on this now and will update you within the hour." },
  { id: 'more-info', label: 'Ask for details (one question)', body: 'Hi {first}, to fix this quickly, could you send the exact error message (a screenshot is perfect)?' },
  { id: 'restart', label: 'Restart & retest', body: 'Could you restart your device and try again? If it still happens, reply here and I’ll jump on a quick call.' },
  { id: 'vendor', label: 'Waiting on vendor', body: "Quick update: we've escalated this to the vendor and are waiting on their response. I'll keep you posted — nothing needed from you right now." },
  { id: 'check-in', label: 'Resolution check-in', body: 'Hi {first}, we applied a fix. Can you confirm everything works now? If not, just reply and I’ll reopen this right away.' },
  { id: 'call', label: 'Offer a quick call', body: 'Happy to hop on a 10-minute call if that’s easier — just reply with a time that works for you.' },
];
