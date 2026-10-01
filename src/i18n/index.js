'use strict';

// To add a language: drop in <code>.json with the same keys as en.json and register it here.
const catalogs = {
  en: require('./en.json'),
  sn: require('./sn.json'),
};

const DEFAULT_LANGUAGE = 'en';
const LANGUAGES = Object.keys(catalogs);

const isSupported = lang => Object.hasOwn(catalogs, lang);

const lookup = (catalog, key) =>
  key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), catalog);

const fill = (template, vars) =>
  template.replace(/\{(\w+)\}/g, (match, name) => (vars[name] !== undefined ? String(vars[name]) : match));

/**
 * Translates a dotted key ("ussd.main"), falling back to English for missing languages or keys.
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 */
function t(lang, key, vars = {}) {
  const template =
    lookup(catalogs[lang] ?? {}, key) ?? lookup(catalogs[DEFAULT_LANGUAGE], key);
  if (typeof template !== 'string') throw new Error(`Missing translation: ${key}`);
  return fill(template, vars);
}

/** Whether an English template exists for a key (every language falls back to English). */
const has = key => typeof lookup(catalogs[DEFAULT_LANGUAGE], key) === 'string';

/** A recipient's display name in a language ("Mama" / "Amai"), or their seed name. */
const recipientName = (lang, recipient) =>
  lookup(catalogs[lang] ?? {}, `recipients.${recipient.id}`) ?? recipient.name;

const languageName = lang => catalogs[lang].language;

module.exports = { DEFAULT_LANGUAGE, LANGUAGES, isSupported, has, t, recipientName, languageName };
