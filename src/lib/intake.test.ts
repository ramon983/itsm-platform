import { describe, expect, it } from 'vitest';

import { END_USERS, createSeedState } from '@/data/seed';
import { INTAKE_PRESETS, analyzeIntake, detectLanguage, hasTerm } from '@/lib/intake';

const seed = createSeedState(Date.parse('2026-11-17T09:00:00Z'));
const persona = (email: string) => END_USERS.find((u) => u.email === email)!;
const run = (email: string, ...userMessages: string[]) =>
  analyzeIntake({ requester: persona(email), assets: seed.assets, saasApps: seed.saasApps, userMessages });
const preset = (id: string) => INTAKE_PRESETS.find((p) => p.id === id)!;

describe('language detection', () => {
  it.each([
    ['Hola, no puedo conectarme a la VPN desde esta mañana', 'es'],
    ["Bonjour, mon écran est fissuré, j'ai besoin d'un ordinateur de prêt", 'fr'],
    ['来週のデザインスプリントのためにFigmaの編集ライセンスを付与してください。', 'ja'],
    ['Wir benötigen heute Abend um 22:00 Uhr ein Wartungsfenster', 'de'],
    ['As chamadas no Slack caem toda vez que ando pelo terceiro andar', 'pt'],
    ['Ciao, non riesco ad accedere a Salesforce da stamattina', 'it'],
    ['My laptop keeps crashing when I open Zoom', 'en'],
  ])('%s → %s', (text, lang) => expect(detectLanguage(text).lang).toBe(lang));

  it('matches latin terms at word starts only', () => {
    expect(hasTerm('no puedo conectarme', 'conect')).toBe(true);
    expect(hasTerm('reduce the redirect', 'red')).toBe(false);
  });
});

describe('preset mapping', () => {
  it('Spanish VPN before client pitch → #INC-NET-04, P1, MBP-0942', () => {
    const a = run(preset('es-vpn').personaEmail, preset('es-vpn').text);
    expect(a).toMatchObject({ detectedLanguage: 'es', templateId: '#INC-NET-04', priority: 'P1', sentiment: 'Urgent Client Impact', linkedAssetId: 'MBP-0942', replyLanguage: 'es', suggestedKbId: 'KB-402', swarmSquad: 'Network & Identity' });
    expect(a.replyNative).toMatch(/^Hola María/);
    expect(a.replyNative).toContain('KB-402');
    expect(a.recommendedMacro?.label).toBe('Push Split-Tunnel Certificate to MBP-0942');
    expect(a.clarifyingQuestion).toBeNull();
  });

  it('French cracked screen → #SR-HW-01, P2, MBP-1004 with loaner macro', () => {
    const a = run(preset('fr-screen').personaEmail, preset('fr-screen').text);
    expect(a).toMatchObject({ detectedLanguage: 'fr', templateId: '#SR-HW-01', priority: 'P2', linkedAssetId: 'MBP-1004', replyLanguage: 'fr' });
    expect(a.fields.find((f) => f.key === 'needed_by')?.value).toBe('Thursday');
    expect(a.replyNative).toContain('jeudi');
    expect(a.recommendedMacro?.id).toBe('macro-assign-loaner');
  });

  it('Japanese Figma licence → #SR-SAAS-09 linked to Figma', () => {
    const a = run(preset('ja-figma').personaEmail, preset('ja-figma').text);
    expect(a).toMatchObject({ detectedLanguage: 'ja', templateId: '#SR-SAAS-09', priority: 'P3', linkedSaasId: 'saas-figma', suggestedKbId: 'KB-405', sentiment: 'Calm' });
    expect(a.fields.find((f) => f.key === 'access_level')?.value).toBe('Editor');
    expect(a.fields.find((f) => f.key === 'business_reason')?.value).toBe('Design sprint');
    expect(a.replyNative).toContain('Haruto');
  });

  it('German SAML emergency → #CHG-SEC-02 capped at P2 with 22:00 window', () => {
    const a = run(preset('de-saml').personaEmail, preset('de-saml').text);
    expect(a).toMatchObject({ detectedLanguage: 'de', templateId: '#CHG-SEC-02', ticketType: 'CHANGE', priority: 'P2', sentiment: 'Urgent Client Impact', suggestedKbId: 'KB-421' });
    expect(a.fields.find((f) => f.key === 'window')?.value).toBe('22:00 tonight');
    expect(a.requiredApprovals).toContain('CAB (emergency)');
  });
});

describe('freeform and multi-turn', () => {
  it('asks exactly one clarifying question when a critical field is missing, then fills it on the next turn', () => {
    const first = run('haruto.tanaka@adminzero.io', 'ライセンスが必要です');
    expect(first.templateId).toBe('#SR-SAAS-09');
    expect(first.clarifyingQuestion).toBe('どのアプリケーションへのアクセスが必要ですか？');
    const second = run('haruto.tanaka@adminzero.io', 'ライセンスが必要です', 'Figmaです');
    expect(second.clarifyingQuestion).toBeNull();
    expect(second.linkedSaasId).toBe('saas-figma');
  });

  it('replies natively in Italian and falls back to English for unsupported languages', () => {
    expect(run('priya.shah@adminzero.io', 'Ciao, non riesco a collegarmi alla VPN, ho una presentazione con un cliente tra 30 minuti').replyLanguage).toBe('it');
    const nl = run('priya.shah@adminzero.io', 'Hallo, mijn laptop scherm is kapot en ik kan niet werken');
    expect(nl.detectedLanguage).toBe('nl');
    expect(nl.replyLanguage).toBe('en');
  });

  it('never offers a self-service step without a KB article', () => {
    const a = run('priya.shah@adminzero.io', 'I need help with something odd on my account');
    expect(a.suggestedKbId).toBeUndefined();
    expect(a.replyNative).not.toMatch(/KB-\d+/);
  });
});
