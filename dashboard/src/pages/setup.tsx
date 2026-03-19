import { useState } from "react";
import { useCreateBusiness, CreateBusinessRequest } from "@/api-client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";
import { VoicePicker, type VoiceName } from "@/components/voice-picker";
import { TelnyxNumberPicker } from "@/components/telnyx-number-picker";

export default function Setup() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Partial<CreateBusinessRequest>>({
    voice: 'nova',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const createBusiness = useCreateBusiness();
  const { toast } = useToast();

  const handleNext = () => setStep(s => Math.min(4, s + 1));
  const handleBack = () => setStep(s => Math.max(1, s - 1));

  const handleSubmit = async () => {
    try {
      const payload: CreateBusinessRequest = {
        name: formData.name || 'My Business',
        did: formData.did || '+15550000000',
        greeting: formData.greeting || 'Hello! How can I help you today?',
        persona: formData.persona || 'You are a helpful assistant.',
        timezone: formData.timezone || 'UTC',
        voice: formData.voice || 'nova',
        transfer_number: formData.transfer_number,
        after_hours_number: formData.after_hours_number,
        max_concurrent_calls: 10,
        max_calls_per_caller_hour: 5,
        rag_semantic_weight: 0.5,
        chunk_size_tokens: 500,
        chunk_overlap_tokens: 50,
        recording_enabled: true,
        sms_enabled: false,
        calendar_enabled: false,
        data_retention_days: 90,
      };

      await createBusiness.mutateAsync({ data: payload });
      toast({ title: "Setup Complete!", description: "Welcome to your dashboard." });
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      window.location.href = `${base}/calls`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Setup failed";
      toast({ title: "Setup Failed", description: message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-12 flex justify-between items-center relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-border/50 rounded-full z-0" />
          <div 
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded-full z-0 transition-all duration-500 ease-out" 
            style={{ width: `${((step - 1) / 3) * 100}%` }} 
          />
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${step >= i ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30' : 'bg-card border-2 border-border text-muted-foreground'}`}>
              {step > i ? <CheckCircle2 className="w-5 h-5" /> : i}
            </div>
          ))}
        </div>

        <Card className="bg-card/80 backdrop-blur-xl border-border/50 shadow-2xl p-8 overflow-hidden rounded-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-display font-bold">Business Identity</h2>
                    <p className="text-muted-foreground mt-1">Let's give your AI assistant a personality.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Business Name</label>
                    <Input value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Acme Corp" className="h-12" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">System Persona</label>
                    <Textarea 
                      value={formData.persona || ''} 
                      onChange={e => setFormData({...formData, persona: e.target.value})} 
                      placeholder="You are a polite receptionist for Acme Corp. You help book appointments..." 
                      className="h-32 resize-none"
                    />
                  </div>
                  <VoicePicker
                    value={formData.voice || 'nova'}
                    onChange={(v: VoiceName) => setFormData({...formData, voice: v})}
                  />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-display font-bold">Greeting & Timezone</h2>
                    <p className="text-muted-foreground mt-1">How should the AI answer the phone?</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Initial Greeting</label>
                    <Textarea 
                      value={formData.greeting || ''} 
                      onChange={e => setFormData({...formData, greeting: e.target.value})} 
                      placeholder="Hello! Thank you for calling Acme Corp. How can I help you today?" 
                      className="h-24"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Timezone</label>
                    <Input 
                      value={formData.timezone || ''} 
                      onChange={e => setFormData({...formData, timezone: e.target.value})} 
                      placeholder="America/New_York" 
                      className="h-12"
                    />
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-display font-bold">Phone Routing</h2>
                    <p className="text-muted-foreground mt-1">Configure your numbers and transfer rules.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Business Phone Number (DID)</label>
                    <Input 
                      value={formData.did || ''} 
                      onChange={e => setFormData({...formData, did: e.target.value})} 
                      placeholder="+15551234567" 
                      className="h-12 font-mono"
                    />
                    <p className="text-xs text-muted-foreground">The number callers will dial. Enter your own or get one from Telnyx.</p>
                    <TelnyxNumberPicker
                      onNumberSelected={(num) => setFormData({...formData, did: num})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Human Transfer Number</label>
                    <Input 
                      value={formData.transfer_number || ''} 
                      onChange={e => setFormData({...formData, transfer_number: e.target.value})} 
                      placeholder="+15559876543" 
                      className="h-12 font-mono"
                    />
                    <p className="text-xs text-muted-foreground">Where the AI should transfer complex queries.</p>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-display font-bold text-center">Ready to Launch</h2>
                    <p className="text-muted-foreground mt-1 text-center">Review your settings and create your assistant.</p>
                  </div>
                  <div className="bg-background rounded-xl p-6 space-y-4 border border-border/50">
                    <div className="flex justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">Business Name</span>
                      <span className="font-semibold">{formData.name || 'Not set'}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">Phone Number</span>
                      <span className="font-mono">{formData.did || 'Not set'}</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2">
                      <span className="text-muted-foreground">Voice Model</span>
                      <span className="capitalize">{formData.voice}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Transfer To</span>
                      <span className="font-mono">{formData.transfer_number || 'None'}</span>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="flex justify-between mt-10 pt-6 border-t border-border">
            <Button variant="ghost" onClick={handleBack} disabled={step === 1} className="text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
            
            {step < 4 ? (
              <Button onClick={handleNext} className="bg-primary hover:bg-primary/90">
                Next <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button 
                onClick={handleSubmit} 
                disabled={createBusiness.isPending}
                className="bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-600 hover:to-emerald-500 shadow-lg shadow-emerald-500/20"
              >
                {createBusiness.isPending ? "Creating..." : "Launch Assistant"}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
