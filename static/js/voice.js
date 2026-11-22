// Voz: reconhecimento (fala → texto) e síntese (texto → fala) em pt-BR, direto no navegador.
import { state } from './core.js';

const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!Rec;
export const canSpeak = 'speechSynthesis' in window;

let rec = null;
let speakingResolve = null;

export function listen({ onInterim, onFinal, onEnd, onError } = {}) {
  if (!Rec) { onError && onError('unsupported'); return null; }
  stopListening();
  rec = new Rec();
  rec.lang = 'pt-BR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    onInterim && onInterim((finalText + ' ' + interim).trim());
  };
  rec.onerror = (e) => { onError && onError(e.error || 'erro'); };
  rec.onend = () => {
    const t = finalText.trim();
    rec = null;
    if (t) onFinal && onFinal(t);
    onEnd && onEnd(t);
  };
  try { rec.start(); } catch (e) { onError && onError(String(e)); return null; }
  return rec;
}

export function stopListening() { if (rec) { try { rec.stop(); } catch (_) {} } }
export function isListening() { return !!rec; }

export function voices() {
  if (!canSpeak) return [];
  const all = speechSynthesis.getVoices();
  const pt = all.filter((v) => v.lang && v.lang.toLowerCase().startsWith('pt'));
  return pt.length ? pt : all;
}

function pickVoice() {
  const list = voices();
  const wanted = state.settings.voice;
  return list.find((v) => v.name === wanted)
    || list.find((v) => v.lang === 'pt-BR' && /google|luciana|francisca|antonio|daniel|thiago/i.test(v.name))
    || list.find((v) => v.lang === 'pt-BR') || list[0] || null;
}

function clean(text) {
  return String(text || '')
    .replace(/[*_#`>]/g, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .trim();
}

export function speak(text, { force = false } = {}) {
  return new Promise((resolve) => {
    if (!canSpeak || (!force && state.settings.auto_speak === false)) return resolve();
    const t = clean(text);
    if (!t) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'pt-BR';
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = Number(state.settings.voice_rate || 1);
    u.pitch = Number(state.settings.voice_pitch || 1);
    speakingResolve = resolve;
    u.onend = u.onerror = () => { speakingResolve = null; resolve(); };
    speechSynthesis.speak(u);
    // Safari às vezes não dispara onend
    setTimeout(() => { if (speakingResolve === resolve) { speakingResolve = null; resolve(); } }, Math.max(4000, t.length * 120));
  });
}

export function stopSpeaking() { if (canSpeak) speechSynthesis.cancel(); if (speakingResolve) { speakingResolve(); speakingResolve = null; } }
export function isSpeaking() { return canSpeak && speechSynthesis.speaking; }

/** iOS só permite falar depois de um toque: “destrava” a síntese no primeiro gesto. */
export function unlockSpeech() {
  if (!canSpeak || unlockSpeech.done) return;
  unlockSpeech.done = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (_) {}
}

if (canSpeak) speechSynthesis.onvoiceschanged = () => window.dispatchEvent(new Event('jarvis:voices'));
