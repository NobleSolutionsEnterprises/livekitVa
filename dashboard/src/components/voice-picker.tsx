import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic2, Volume2, Square } from "lucide-react";

const VOICES = ['alloy', 'nova', 'echo', 'fable', 'onyx', 'shimmer'] as const;
export type VoiceName = typeof VOICES[number];

const VOICE_DESCRIPTIONS: Record<VoiceName, string> = {
  alloy: "Neutral & balanced",
  nova: "Warm & friendly",
  echo: "Clear & direct",
  fable: "Expressive & dynamic",
  onyx: "Deep & authoritative",
  shimmer: "Bright & upbeat",
};

const SAMPLE_TEXT = "Hello! Thank you for calling. How can I help you today?";

function playVoicePreview(voiceName: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(SAMPLE_TEXT);
  utterance.rate = 0.95;
  utterance.pitch = 1.0;

  switch (voiceName) {
    case "alloy":
      utterance.pitch = 1.0;
      utterance.rate = 1.0;
      break;
    case "nova":
      utterance.pitch = 1.15;
      utterance.rate = 0.95;
      break;
    case "echo":
      utterance.pitch = 0.85;
      utterance.rate = 1.05;
      break;
    case "fable":
      utterance.pitch = 1.1;
      utterance.rate = 0.9;
      break;
    case "onyx":
      utterance.pitch = 0.7;
      utterance.rate = 0.9;
      break;
    case "shimmer":
      utterance.pitch = 1.3;
      utterance.rate = 1.0;
      break;
  }

  window.speechSynthesis.speak(utterance);
  return utterance;
}

interface VoicePickerProps {
  value: string;
  onChange: (voice: VoiceName) => void;
}

export function VoicePicker({ value, onChange }: VoicePickerProps) {
  const [playing, setPlaying] = useState<string | null>(null);

  const handlePreview = useCallback((voice: string) => {
    if (playing === voice) {
      window.speechSynthesis.cancel();
      setPlaying(null);
      return;
    }
    const utterance = playVoicePreview(voice);
    if (utterance) {
      setPlaying(voice);
      utterance.onend = () => setPlaying(null);
      utterance.onerror = () => setPlaying(null);
    }
  }, [playing]);

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium flex items-center gap-2">
        <Mic2 className="w-4 h-4" /> AI Voice
      </label>
      <div className="grid grid-cols-3 gap-3">
        {VOICES.map(v => (
          <div key={v} className="relative group">
            <Button
              type="button"
              variant={value === v ? "default" : "outline"}
              className={`w-full h-14 flex flex-col gap-0.5 ${value === v ? 'ring-2 ring-primary/50 shadow-lg shadow-primary/20' : ''}`}
              onClick={() => onChange(v)}
            >
              <span className="capitalize text-sm font-semibold">{v}</span>
              <span className={`text-[10px] ${value === v ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                {VOICE_DESCRIPTIONS[v]}
              </span>
            </Button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handlePreview(v); }}
              className={`absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-md
                ${playing === v 
                  ? 'bg-primary text-primary-foreground scale-110' 
                  : 'bg-card border border-border text-muted-foreground hover:text-primary hover:border-primary/50'
                }`}
              title={playing === v ? "Stop preview" : `Preview ${v} voice`}
            >
              {playing === v
                ? <Square className="w-3 h-3" />
                : <Volume2 className="w-3.5 h-3.5" />
              }
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Click the speaker icon to hear a preview of each voice.</p>
    </div>
  );
}
