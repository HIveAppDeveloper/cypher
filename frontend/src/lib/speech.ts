export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

export type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike> & {
  isFinal: boolean;
};

export interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionErrorEventLike {
  error: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition;
}

export function hasSpeechRecognition(): boolean {
  return !!getSpeechRecognitionConstructor();
}

export function createSpeechRecognition(): SpeechRecognitionLike | null {
  const Recognition = getSpeechRecognitionConstructor();
  return Recognition ? new Recognition() : null;
}

export function describeSpeechError(error: string): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Allow microphone access in your browser, then try again.';
  }
  if (error === 'no-speech') return 'No speech detected. Try again.';
  if (error === 'audio-capture') return 'No microphone is available to this browser.';
  return 'Speech recognition stopped. Check your browser speech settings and try again.';
}
