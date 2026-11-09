"use client";

import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CHAT_TEXT_LIMIT } from "@/lib/chat-input";

type RecognitionResult = { isFinal: boolean; [index: number]: { transcript: string } };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};
type SpeechWindow = {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

const errorMessages: Record<string, string> = {
  "not-allowed": "Microphone access was denied. Allow it in your browser’s site settings, then try again.",
  "service-not-allowed": "Your browser’s speech service is unavailable. You can still type your message.",
  "audio-capture": "No microphone is available. Check your microphone connection and try again.",
  "no-speech": "No speech was detected. Try the microphone again when you’re ready.",
  network: "Voice input couldn’t connect. Check your connection and try again.",
  "language-not-supported": "Your browser doesn’t support dictation in this language. You can still type your message.",
};

function release(recognition: Recognition | null) {
  if (!recognition) return;
  recognition.onstart = recognition.onend = recognition.onresult = recognition.onerror = null;
  // Abort discards pending results when sending, switching chats, or leaving the page.
  try { recognition.abort(); } catch { /* The browser may already have ended the session. */ }
}

export function useChatDictation(setDraft: Dispatch<SetStateAction<string>>) {
  const [phase, setPhase] = useState<"idle" | "starting" | "listening" | "stopping">("idle");
  const [error, setError] = useState<string>();
  const recognitionRef = useRef<Recognition | null>(null);

  useLayoutEffect(() => () => {
    // Next.js Activity preserves state when hiding a chat, so reset recording too.
    release(recognitionRef.current);
    recognitionRef.current = null;
    setPhase("idle");
    setError(undefined);
  }, []);

  const cancel = useCallback(() => {
    release(recognitionRef.current);
    recognitionRef.current = null;
    setPhase("idle");
    setError(undefined);
  }, []);

  function toggle() {
    const current = recognitionRef.current;
    if (current) {
      if (phase === "listening") {
        setPhase("stopping");
        // A normal stop keeps the final words captured before the click.
        try { current.stop(); } catch { cancel(); }
      } else if (phase !== "stopping") {
        cancel();
      }
      return;
    }

    setError(undefined);
    const speechWindow = window as unknown as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input isn’t supported in this browser. You can still type your message.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = navigator.language || "en-US";
      recognition.continuous = true;
      recognition.interimResults = false;
      let nextResult = 0;

      recognition.onstart = () => {
        if (recognitionRef.current === recognition) setPhase("listening");
      };
      recognition.onresult = (event) => {
        if (recognitionRef.current !== recognition) return;
        for (let index = Math.max(nextResult, event.resultIndex); index < event.results.length; index++) {
          const result = event.results[index];
          if (!result.isFinal) continue;
          nextResult = index + 1;
          const text = result[0]?.transcript.trim();
          if (text) setDraft((draft) => `${draft}${draft && !/\s$/.test(draft) ? " " : ""}${text}`.slice(0, CHAT_TEXT_LIMIT));
        }
      };
      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        release(recognition);
        recognitionRef.current = null;
        setPhase("idle");
      };
      recognition.onerror = ({ error: code }) => {
        if (recognitionRef.current !== recognition) return;
        release(recognition);
        recognitionRef.current = null;
        setPhase("idle");
        if (code !== "aborted") setError(errorMessages[code] ?? "Voice input couldn’t start. Please try again or type your message.");
      };
      setPhase("starting");
      recognition.start();
    } catch {
      cancel();
      setError("Voice input couldn’t start. Check your microphone permissions and try again.");
    }
  }

  return { phase, error, toggle, cancel };
}
