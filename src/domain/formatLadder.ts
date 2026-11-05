// The format ladder (v0.5.3 B2, docs/decisions/0071): retrieval gets harder as a card gets
// stronger. Pure; the study screens read it for the card on screen.
//
//   Card stage           Kelime (recognition)       Üretim (production)          Boşluk (cloze)
//   Öğreniyor/Pekişiyor  term + example sentence    TR meaning + blanked sentence choices allowed
//   Öğrenildi / Kalıcı   term only (sentence after  TR meaning only; the sentence typed only
//                        the flip)                  is a hint (counts as a hint)
//
// The stage is the card's own (domain/stages.ts), so a production card that is still young
// keeps its sentence even when the word's recognition card is Öğrenildi.
import { cardStage, isLearnedStage, type StageInput } from './stages';

export interface CardFormat {
  /** Recognition: the example sentence is on the front (false: only after the flip). */
  sentenceOnFront: boolean;
  /** Production: the blanked sentence hides behind a hint button (showing it = a hint). */
  sentenceAsHint: boolean;
  /** Cloze: multiple choices may be offered (false: the answer is typed). */
  choicesAllowed: boolean;
}

export function cardFormat(card: StageInput): CardFormat {
  const strong = isLearnedStage(cardStage(card));
  return { sentenceOnFront: !strong, sentenceAsHint: strong, choicesAllowed: !strong };
}
