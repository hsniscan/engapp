// Privacy policy (English translation for Google Play reviewers). Keep it in step with
// privacy.tr.ts, which is the binding text; same sources (ADR 0035).
import { CONTROLLER_NAME, PRIVACY_UPDATED, type LegalDocument } from './types';

export const privacyEn: LegalDocument = {
  lang: 'en',
  title: 'Privacy policy',
  updated: PRIVACY_UPDATED,
  intro: [
    'Engapp is an app for learning English vocabulary with spaced repetition. This policy explains which personal data we process and why, where it is kept and how you delete it, in line with the Turkish Personal Data Protection Law No. 6698 (KVKK).',
  ],
  sections: [
    {
      id: 'summary',
      heading: 'Summary',
      blocks: [
        {
          ul: [
            'In guest mode all your data stays on your own device; nothing reaches us.',
            'If you sign in with Google, your cards and study history are stored on our server so that they sync between your devices.',
            'When you use the AI features, the text you send is processed by Google Gemini. Do not send text that contains confidential or personal information.',
            'No ads, we do not sell your data, and we use no analytics or tracking tools.',
            'You can delete your account and all your data at any time in the app or on the [account deletion page](/hesap-sil).',
          ],
        },
      ],
    },
    {
      id: 'controller',
      heading: 'Data controller and contact',
      blocks: [
        {
          p: `The data controller is ${CONTROLLER_NAME}, who publishes Engapp as an individual developer. For any question or request about this policy or your data: {{email}}.`,
        },
      ],
    },
    {
      id: 'data',
      heading: 'What data we process',
      blocks: [
        { p: '**Guest mode.** Without an account, your cards, history and settings are kept only in this device\'s browser database (or the app\'s own storage). AI and sync are not available in guest mode, and no data is sent to the server.' },
        { p: '**Google sign-in.** You sign in with your Google account through Supabase Auth. We receive only your name, e-mail address, the link to your profile photo and your Google account ID. Your password never reaches us.' },
        { p: '**Your study data** (when signed in, stored on the server for sync):' },
        {
          ul: [
            'the words and phrases you add, their meanings, your tags and decks;',
            'your own example sentences and their translations, your own memory aids, example sentences you edited, and the like/hide marks you set on content;',
            'the review schedule of your cards and your answer history: which card you answered when, with which answer and how long it took, and your practice answers;',
            'your level test results, words you know, your weekly report summaries (numbers and, if any, an AI comment);',
            'your settings: time zone, start of day, level, interests, goals and notification preference;',
            'the title, file name and page count of the sources you import (the full text is not stored on the server).',
          ],
        },
        { p: '**Device ID.** For sync, the app gives each installation a random device ID and writes it into answer records. It is not an advertising ID; no hardware identifiers of your phone are accessed.' },
        { p: '**Text processed by AI.** Text you paste into "create cards from text", or that is read from a PDF you import, is sent in chunks to the server and from there to Google Gemini. The candidate words the AI finds in a chunk, with the sentences they appear in, are kept on the server for at most 90 days so the same text is not processed twice.' },
        { p: '**Usage counters.** To enforce the daily AI, read-aloud and "Görsel üret" (draw a picture) limits, the number of calls per day is counted.' },
        { p: '**Pictures.** Your yes/no answer about a word picture and the picture you chose or hid are stored with your learning data. When you ask for a picture of a meaning, your request is recorded with your account so that we can count how many people asked for the same picture.' },
        { p: '**Notifications.** If you turn on reminders: your browser\'s push service address and encryption keys, the device or browser name, and the days a reminder was sent.' },
        { p: '**What we do not process.** Your location, contacts, photos, microphone and camera are not used. There is no advertising ID and no analytics or tracking tool. The app\'s error log stays on your device and is never sent to us.' },
      ],
    },
    {
      id: 'purposes',
      heading: 'Why we process it',
      blocks: [
        {
          ul: [
            'To create your account, keep you signed in and sync your data between your devices (KVKK art. 5(2)(c): performance of a contract).',
            'To run the AI features you ask for: creating cards from text, looking up meanings, grouping words into themes, reading aloud, drawing word pictures (KVKK art. 5(2)(c)).',
            'To protect the service against abuse, for example with daily usage limits (KVKK art. 5(2)(f): legitimate interest).',
            'If you turned it on, to send at most one study reminder a day.',
          ],
        },
        { p: 'We do not use your data for advertising, marketing or profiling, and we do not sell it to anyone.' },
      ],
    },
    {
      id: 'processors',
      heading: 'Where it is processed and who receives it',
      blocks: [
        { p: 'Engapp uses the following service providers. Some of their servers are outside Türkiye, so your data is transferred abroad (KVKK art. 9).' },
        {
          ul: [
            '**Supabase** (database, sign-in, server functions): your account and study data. The servers are in the European Union, in the Ireland region.',
            '**Cloudflare** (hosting of the website): processes technical connection data such as your IP address and browser details while serving the app\'s files.',
            '**Google**: sign-in with Google; your profile photo is loaded from Google\'s servers. **Google Gemini** (AI): the text chunks you send to create cards, a word you add by hand, your words and their short English definitions for theme grouping, the word or sentence to be read aloud, and only numbers for the weekly report comment.',
            '**Anthropic Claude** (word pictures): only a word from the shared dictionary, its part of speech and Turkish meaning, a short drawing hint, a fixed correction note when a picture is redrawn, and, for the check, the picture Claude drew. Nothing about your account, your cards or your sentences is sent, and neither is who asked for the picture.',
            '**Browser push services** (Google, Mozilla, Apple, Microsoft): if you turned on web reminders, the encrypted reminder text (such as "12 reviews are waiting for you today").',
          ],
        },
        { p: 'We currently use Gemini on its free tier. Under Google\'s terms, text sent on the free tier may be used to improve Google\'s products and may be read by human reviewers. Therefore do not process confidential, business or personal text with the AI features.' },
        { p: 'Example sentences, memory aid suggestions, notes on confusable words and read-aloud audio files are generated from the shared dictionary content; your own sentences are not sent for them.' },
      ],
    },
    {
      id: 'shared-dictionary',
      heading: 'The shared dictionary',
      blocks: [
        { p: 'Word meanings, example sentences, word pictures and the audio of dictionary words are shared by all users. This shared content is not linked to any person: who caused an entry to be added is not recorded, and it contains none of your sentences or personal information. That is why the shared dictionary stays as it is when you delete your account.' },
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      blocks: [
        {
          ul: [
            'Your account and study data are kept while your account exists.',
            'A card or word you delete stays marked as deleted for 30 days, so your other devices learn about the deletion, and is then removed from the server completely.',
            'The AI candidate cache, AI usage counters and the record of sent reminders are deleted after 90 days.',
            'When you delete your account, all your data on the server is deleted immediately.',
            'Technical logs and backups of the service providers follow their own retention periods; they do not contain the content of your cards.',
          ],
        },
      ],
    },
    {
      id: 'deletion',
      heading: 'Deleting your account and data',
      blocks: [
        {
          ul: [
            'In the app: **Ayarlar (Settings) → Hesap (Account) → Hesabımı ve verilerimi sil (Delete my account and data).**',
            'On the web: the [account deletion page](/hesap-sil) — sign in with Google and do the same.',
            'By e-mail: write to {{email}}; we delete your account within 30 days.',
          ],
        },
        { p: 'What is deleted: your cards and words, study history and statistics, settings, reports, notification records, AI cache and counters, picture counters, picture requests and picture answers (for an admin also the admin record and picture review decisions), and then the account itself. Pictures in the shared dictionary stay. Deletion cannot be undone; if you like, first download the JSON backup under **Ayarlar → Veri (Data)**.' },
        { p: 'Guest-mode data exists only on your device: delete it with **Ayarlar → Hesap → Bu cihazdaki verileri sil (Delete the data on this device)** or by uninstalling the app.' },
      ],
    },
    {
      id: 'rights',
      heading: 'Your rights (KVKK art. 11)',
      blocks: [
        { p: 'Under Article 11 of the KVKK you have the right to:' },
        {
          ul: [
            'learn whether your personal data is processed and, if so, request information about it;',
            'learn the purpose of the processing and whether the data is used accordingly;',
            'know the third parties in Türkiye or abroad to whom it is transferred;',
            'request correction if it is incomplete or inaccurate;',
            'request its erasure or destruction under the conditions of KVKK art. 7;',
            'request that third parties who received the data be notified of a correction or erasure;',
            'object to a result against you that arises solely from automated analysis;',
            'claim compensation if you suffer damage from unlawful processing.',
          ],
        },
        { p: 'Send your request to {{email}}; we answer free of charge within 30 days at the latest. If you are not satisfied with the answer, you may complain to the Turkish Personal Data Protection Board (Kişisel Verileri Koruma Kurulu).' },
        { p: 'You can take a copy of your data yourself at any time with **Ayarlar → Veri → JSON yedeğini indir (Download JSON backup)**, and correct a wrong entry in the app.' },
      ],
    },
    {
      id: 'security',
      heading: 'Security',
      blocks: [
        { p: 'All connections between the app and the servers are encrypted (HTTPS). In the database every user can read and write only their own rows (row-level security). AI and server keys are kept only on the server, never in the app.' },
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      blocks: [
        { p: 'Engapp is not designed for people under 18, and we do not knowingly collect data from anyone under 18. If you notice that someone under 18 has created an account, write to {{email}} and we will delete the account and its data.' },
      ],
    },
    {
      id: 'changes',
      heading: 'Changes',
      blocks: [
        { p: 'If this policy changes, the new version is published on this page with its update date. Turkish original: [Gizlilik politikası](/gizlilik). If the two texts differ, the Turkish text prevails.' },
      ],
    },
  ],
};
