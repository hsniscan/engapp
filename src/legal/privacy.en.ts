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
            'If you sign in with Google, your cards, study history, the reading texts you save (pasted texts, articles, PDF, subtitle and photo texts, stories) and your settings are stored on our server so that they sync between your devices.',
            "When you use the AI features, the text you send is processed by Anthropic Claude first, or by Google Gemini when Claude's monthly budget is used up or Claude does not answer. Because we use Gemini on its free tier, text that goes to Gemini may be used to improve Google's products. Do not send text that contains confidential or personal information.",
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
          p: `[[email]] The data controller is ${CONTROLLER_NAME}, who publishes Engapp as an individual developer. For any question or request about this policy or your data: {{email}}.`,
        },
        {
          p: `[[noemail]] The data controller is ${CONTROLLER_NAME}, who publishes Engapp as an individual developer. No separate contact address has been published yet; until then you can do everything about your data inside the app: take a copy with **Profil → Ayarlar → Yedek ve veri → Yedek al (Back up)**, correct a wrong entry, and delete your account and all your data with **Profil → Ayarlar → Hesap ve eşitleme → Hesabımı ve verilerimi sil** or on the [account deletion page](/hesap-sil).`,
        },
      ],
    },
    {
      id: 'data',
      heading: 'What data we process',
      blocks: [
        {
          p: "**Guest mode.** Without an account, your cards, history and settings are kept only in this device's browser database (or the app's own storage). AI and sync are not available in guest mode, and no data is sent to the server.",
        },
        {
          p: '**Google sign-in.** You sign in with your Google account through Supabase Auth. We receive only your name, e-mail address, the link to your profile photo and your Google account ID. Your password never reaches us.',
        },
        { p: '**Your study data** (when signed in, stored on the server for sync):' },
        {
          ul: [
            'the words and phrases you add, their meanings, your tags and decks;',
            'your own example sentences and their translations, your own memory aids, example sentences you edited, and the like/hide marks you set on content;',
            'the review schedule of your cards and your answer history: which card you answered when, with which answer and how long it took, and your practice answers;',
            'your level test results, words you know, your weekly report summaries (numbers and, if any, an AI comment);',
            'your settings: time zone, start of day, level, interests, goals and notification preference;',
            'the title, file name and page count of the sources you import (this source list does not hold the text itself);',
            'the reading texts you save: the full text you paste or take from a PDF, a link (article), a subtitle file or a photo, its title and source address if any, your reading position, reading time and the feedback you give on the text; your daily stories and your reading state in library texts are included;',
            'how many times a day you met each of your words while reading and studying.',
          ],
        },
        {
          p: '**Device ID.** For sync, the app gives each installation a random device ID and writes it into answer records. It is not an advertising ID; no hardware identifiers of your phone are accessed.',
        },
        {
          p: '**Text processed by AI.** Text you paste into "create cards from text", or that is read from a PDF you import, is sent in chunks to the server and from there to Anthropic Claude (or to Google Gemini when Claude cannot be used). The candidate words the AI finds in a chunk, with the sentences they appear in, are kept on the server for at most 90 days so the same text is not processed twice.',
        },
        {
          p: '**Article and subtitle import.** When you import an article from a link, only the address goes to our server; the server downloads the page, extracts its text, sends it to you and keeps neither the address nor the text while doing so. The text is saved with its address on your device among your reading texts and, if you are signed in, syncs with your own account as described above; it never goes to shared tables or other users. Subtitle files are read only on your device; the text you take from one is saved and synced the same way.',
        },
        {
          p: "**Today's story.** When you ask for a story, only that day's 5–8 words (in the dictionary form of your cards), your level, your chosen reading difficulty and at most three of your interests go to our server; none of your texts, sentences or meanings. The server has Anthropic Claude write the story, sends it to you and does not keep it; only how many stories you asked for per day is counted. The story is saved on your device as your own text and syncs only with your own account.",
        },
        {
          p: '**Usage counters.** To enforce the daily AI and read-aloud limits, the number of calls per day is counted.',
        },
        {
          p: '**Pictures.** The pictures you hid (and, from older app versions, your yes/no answers and the pictures you chose) are stored with your learning data. Pictures are drawn once, in bulk, for the shared dictionary; the app never asks for a picture on your behalf.',
        },
        {
          p: "**Notifications.** If you turn on reminders: your browser's push service address and encryption keys, the device or browser name, and the days a reminder was sent.",
        },
        {
          p: '**Cost and sync limits.** To keep AI costs bounded for everyone, we count the estimated amount your account spent on AI requests this month (only a dollar amount, not the content of the requests) and how many times a day you used each AI feature. Against abuse we also count how many sync requests were sent per day and how many rows and how much data (bytes) they carried. These counters contain none of your texts or cards.',
        },
        {
          p: '**Text from a photo.** A photo you take or pick for "Text from a photo" is read on your device only: by Google ML Kit in the Android app, by Tesseract running inside your browser on the web. The photo is never sent to a server and is not kept. If you save the recognised text, only the text is saved, among your reading texts, and syncs with your own account if you are signed in. In the Android app, Google ML Kit sends usage and performance information to Google to measure how it works (device model, Android and app version, a per-installation identifier, how long it took, error codes); it contains no photo and no recognised text.',
        },
        {
          p: '**What we do not process.** Your location, contacts, microphone and photo library are not used. The camera opens only when you start "Text from a photo"; the app has no camera permission, the phone\'s own camera app takes the picture. There is no advertising ID and no analytics or tracking tool. The app\'s error log stays on your device and is never sent to us.',
        },
      ],
    },
    {
      id: 'purposes',
      heading: 'Why we process it',
      blocks: [
        {
          ul: [
            'To create your account, keep you signed in and sync your data between your devices (KVKK art. 5(2)(c): performance of a contract).',
            'To run the AI features you ask for: creating cards from text, looking up meanings, grouping words into themes, reading aloud (KVKK art. 5(2)(c)).',
            'To protect the service against abuse, for example with daily usage limits (KVKK art. 5(2)(f): legitimate interest).',
            'If you turned it on, to send at most one study reminder a day.',
          ],
        },
        {
          p: 'We do not use your data for advertising, marketing or profiling, and we do not sell it to anyone.',
        },
      ],
    },
    {
      id: 'processors',
      heading: 'Where it is processed and who receives it',
      blocks: [
        {
          p: 'Engapp uses the following service providers. Some of their servers are outside Türkiye, so your data is transferred abroad (KVKK art. 9).',
        },
        {
          ul: [
            '**Supabase** (database, sign-in, server functions): your account and study data. The servers are in the European Union, in the Ireland region.',
            "**Cloudflare** (hosting of the website): processes technical connection data such as your IP address and browser details while serving the app's files. **Cloudflare R2** (file storage): the shared dictionary's audio files and the encrypted backups of the database.",
            '**Google**: sign-in with Google; your profile photo is loaded from Google\'s servers. **Google ML Kit** (only in the Android app, when you use "Text from a photo"): the usage and performance information described above; no photo and no text. **Google Gemini** (AI backup and reading aloud): when Claude\'s monthly budget is used up or Claude does not answer, the same AI requests listed below for Claude are processed by Gemini; a word or sentence to be read aloud that has no ready-made audio file also goes to Gemini.',
            '**Anthropic Claude** (word pictures, drawn once in bulk for the shared dictionary): only a word from the shared dictionary, its part of speech and Turkish meaning, a short drawing hint, a fixed correction note when a picture is redrawn, and, for the check, the picture Claude drew. Nothing about your account, your cards or your sentences is sent.',
            "**Anthropic Claude** (AI): the text chunks you send to create cards, a word you add by hand, your words and their short English definitions for theme grouping, and only numbers for the weekly report comment. **Anthropic Claude** (Today's story): only the word list, level, difficulty and interests described above.",
            '**Browser push services** (Google, Mozilla, Apple, Microsoft): if you turned on web reminders, the encrypted reminder text (such as "12 cards are ready for review today").',
          ],
        },
        {
          p: "Text sent to Claude through Anthropic's paid API is not used to train its models under Anthropic's commercial terms. Gemini, our backup, is used on its free tier: under Google's terms, text sent on the free tier may be used to improve Google's products and may be read by human reviewers. Since you cannot know in advance which text goes to the backup, do not process confidential, business or personal text with the AI features.",
        },
        {
          p: 'Example sentences, memory aid suggestions, notes on confusable words and read-aloud audio files are generated from the shared dictionary content; your own sentences are not sent for them.',
        },
      ],
    },
    {
      id: 'shared-dictionary',
      heading: 'The shared dictionary',
      blocks: [
        {
          p: 'Word meanings, example sentences, word pictures and the audio of dictionary words are shared by all users. This shared content is not linked to any person: who caused an entry to be added is not recorded, and it contains none of your sentences or personal information. That is why the shared dictionary stays as it is when you delete your account.',
        },
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      blocks: [
        {
          ul: [
            'Your account, study data and reading texts are kept while your account exists.',
            'A card or word you delete stays marked as deleted for 30 days, so your other devices learn about the deletion, and is then removed from the server completely.',
            'The AI candidate cache, AI usage counters, sync counters and the record of sent reminders are deleted after 90 days; the monthly AI spend amount is deleted at the end of the following month.',
            'When you delete your account, all your data on the server is deleted immediately.',
            'An encrypted backup of the database is taken every night and kept in Cloudflare R2: daily backups for 14 days, weekly backups for 8 weeks, and backups taken right before a server update for at most 8 weeks. Backups are used only to restore data after a failure; after you delete your account your data stays in these backups for at most these periods and is then deleted automatically.',
            'Technical logs and backups of the service providers follow their own retention periods.',
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
            'In the app: **Profil → Ayarlar (Settings) → Hesap ve eşitleme (Account and sync) → Hesabımı ve verilerimi sil (Delete my account and data).**',
            'On the web: the [account deletion page](/hesap-sil) — sign in with Google and do the same.',
            '[[email]] By e-mail: write to {{email}}; we delete your account within 30 days.',
          ],
        },
        {
          p: 'What is deleted: your cards and words, your reading texts and word encounter counts, study history and statistics, settings, reports, notification records, AI cache, AI and sync counters, your monthly AI spend amount, picture counters, picture requests and picture answers (for an admin also the admin record and picture review decisions), and then the account itself. Pictures in the shared dictionary stay. Deletion cannot be undone; if you like, first download the JSON backup under **Profil → Ayarlar → Yedek ve veri (Backup and data)**.',
        },
        {
          p: 'Guest-mode data exists only on your device: delete it with **Profil → Ayarlar → Hesap ve eşitleme → Bu cihazdaki verileri sil (Delete the data on this device)** or by uninstalling the app.',
        },
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
        {
          p: '[[email]] Send your request to {{email}}; we answer free of charge within 30 days at the latest. If you are not satisfied with the answer, you may complain to the Turkish Personal Data Protection Board (Kişisel Verileri Koruma Kurulu).',
        },
        {
          p: '[[noemail]] No separate address for requests has been published yet. Until then you can exercise most of these rights yourself inside the app (see below), and delete your account and data on the [account deletion page](/hesap-sil). Your right to complain to the Turkish Personal Data Protection Board (Kişisel Verileri Koruma Kurulu) always remains.',
        },
        {
          p: 'You can take a copy of your data yourself at any time with **Profil → Ayarlar → Yedek ve veri → Yedek al (Back up)**, and correct a wrong entry in the app.',
        },
      ],
    },
    {
      id: 'security',
      heading: 'Security',
      blocks: [
        {
          p: 'All connections between the app and the servers are encrypted (HTTPS). Database backups are stored encrypted. In the database every user can read and write only their own rows (row-level security). AI and server keys are kept only on the server, never in the app.',
        },
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      blocks: [
        {
          p: '[[email]] Engapp is not designed for people under 18, and we do not knowingly collect data from anyone under 18. If you notice that someone under 18 has created an account, write to {{email}} and we will delete the account and its data.',
        },
        {
          p: '[[noemail]] Engapp is not designed for people under 18, and we do not knowingly collect data from anyone under 18. If someone under 18 has an account, the account holder or their parent can delete the account and all its data at once in the app or on the [account deletion page](/hesap-sil).',
        },
      ],
    },
    {
      id: 'changes',
      heading: 'Changes',
      blocks: [
        {
          p: 'If this policy changes, the new version is published on this page with its update date. Turkish original: [Gizlilik politikası](/gizlilik). If the two texts differ, the Turkish text prevails.',
        },
      ],
    },
  ],
};
