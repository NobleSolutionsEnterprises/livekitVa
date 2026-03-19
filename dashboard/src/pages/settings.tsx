import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useGetBusiness, useUpdateBusiness, useListFlags, useUpdateFlag, useDeleteBusinessData, UpdateBusinessRequest } from "@/api-client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Save, AlertTriangle, MessageSquare } from "lucide-react";
import { VoicePicker, type VoiceName } from "@/components/voice-picker";
import { TelnyxNumberPicker } from "@/components/telnyx-number-picker";

const FLAG_DESCRIPTIONS: Record<string, string> = {
  enable_reranker: "Use a reranking model to improve RAG retrieval accuracy by re-scoring chunks after initial retrieval.",
  use_groq: "Route LLM inference through Groq for faster response times during calls.",
  allow_outbound_campaigns: "Enable the outbound campaigns feature to make automated outbound calls.",
  enable_semantic_chunking: "Use semantic chunking instead of fixed-size chunking when processing documents.",
};

export default function Settings() {
  const { businessId } = useAuth();
  const { toast } = useToast();
  
  const { data: business } = useGetBusiness(businessId!);
  const updateBusiness = useUpdateBusiness();
  const deleteData = useDeleteBusinessData();
  
  const { data: flagsData } = useListFlags(businessId!);
  const updateFlag = useUpdateFlag();

  const [form, setForm] = useState<Partial<UpdateBusinessRequest>>({});

  useEffect(() => {
    if (business) {
      const { id, owner_id, created_at, active, ...editable } = business;
      setForm(editable as Partial<UpdateBusinessRequest>);
    }
  }, [business]);

  const handleSave = async () => {
    try {
      await updateBusiness.mutateAsync({ businessId: businessId!, data: form as UpdateBusinessRequest });
      toast({ title: "Settings Saved", description: "Your business configuration has been updated." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Save Failed", description: message, variant: "destructive" });
    }
  };

  const handleFlagToggle = async (flag: string, enabled: boolean) => {
    try {
      await updateFlag.mutateAsync({ businessId: businessId!, data: { flag, enabled } });
      toast({ title: "Flag Updated", description: `${flag} is now ${enabled ? 'enabled' : 'disabled'}.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Update Failed", description: message, variant: "destructive" });
    }
  };

  const handleDeleteData = async () => {
    if (window.confirm("CRITICAL WARNING: This will permanently delete ALL call logs, recordings, voicemails, and documents. This action CANNOT be undone. Are you absolutely sure?")) {
      try {
        await deleteData.mutateAsync({ businessId: businessId! });
        toast({ title: "Data Erased", description: "All business data has been permanently deleted." });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast({ title: "Error", description: message, variant: "destructive" });
      }
    }
  };

  if (!business) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground mt-1">Configure your AI assistant infrastructure.</p>
        </div>
        <Button onClick={handleSave} disabled={updateBusiness.isPending} className="shadow-lg shadow-primary/25">
          <Save className="w-4 h-4 mr-2" /> Save Changes
        </Button>
      </div>

      <Tabs defaultValue="general" className="w-full flex flex-col md:flex-row gap-8">
        <TabsList className="flex md:flex-col justify-start bg-transparent border-none h-auto gap-2 md:w-48 shrink-0">
          {[
            { value: 'general', label: 'General' },
            { value: 'phone', label: 'Phone & Transfer' },
            { value: 'rag', label: 'Knowledge / RAG' },
            { value: 'sms', label: 'SMS' },
            { value: 'flags', label: 'Feature Flags' },
            { value: 'privacy', label: 'Data & Privacy' },
          ].map((tab) => (
            <TabsTrigger 
              key={tab.value} 
              value={tab.value} 
              className="justify-start px-4 py-3 rounded-xl data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:border data-[state=active]:border-primary/20 w-full text-left"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1">
          <TabsContent value="general" className="mt-0 space-y-6">
            <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50">
              <h3 className="text-xl font-display font-bold mb-6">General Profile</h3>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Business Name</label>
                  <Input value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} className="bg-background/50 h-11" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">System Persona</label>
                  <Textarea value={form.persona || ''} onChange={e => setForm({...form, persona: e.target.value})} className="h-32 bg-background/50" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Greeting</label>
                  <Textarea value={form.greeting || ''} onChange={e => setForm({...form, greeting: e.target.value})} className="h-20 bg-background/50" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">After-Hours Greeting</label>
                  <Textarea value={form.after_hours_greeting || ''} onChange={e => setForm({...form, after_hours_greeting: e.target.value})} className="h-20 bg-background/50" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Timezone</label>
                  <Input value={form.timezone || ''} onChange={e => setForm({...form, timezone: e.target.value})} className="bg-background/50 h-11" />
                </div>
                <VoicePicker
                  value={form.voice || 'nova'}
                  onChange={(v: VoiceName) => setForm({...form, voice: v})}
                />
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="phone" className="mt-0 space-y-6">
            <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50">
              <h3 className="text-xl font-display font-bold mb-6">Phone & Routing</h3>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Primary Number (DID)</label>
                  <Input value={form.did || ''} onChange={e => setForm({...form, did: e.target.value})} className="bg-background/50 h-11 font-mono" placeholder="+15551234567" />
                  <p className="text-xs text-muted-foreground">The phone number callers dial to reach your AI assistant.</p>
                  <TelnyxNumberPicker
                    businessId={businessId}
                    onNumberSelected={(num) => setForm({...form, did: num})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Human Transfer Number</label>
                  <Input value={form.transfer_number || ''} onChange={e => setForm({...form, transfer_number: e.target.value})} className="bg-background/50 h-11 font-mono" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">After-Hours Number</label>
                  <Input value={form.after_hours_number || ''} onChange={e => setForm({...form, after_hours_number: e.target.value})} className="bg-background/50 h-11 font-mono" />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Max Concurrent Calls</label>
                    <Input type="number" value={form.max_concurrent_calls || 10} onChange={e => setForm({...form, max_concurrent_calls: parseInt(e.target.value)})} className="bg-background/50 h-11" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Max Calls / Caller / Hour</label>
                    <Input type="number" value={form.max_calls_per_caller_hour || 5} onChange={e => setForm({...form, max_calls_per_caller_hour: parseInt(e.target.value)})} className="bg-background/50 h-11" />
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="rag" className="mt-0 space-y-6">
            <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50">
              <h3 className="text-xl font-display font-bold mb-6">Knowledge Base Engine</h3>
              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <label className="text-sm font-medium">Semantic Weight</label>
                    <span className="font-mono text-primary font-bold">{form.rag_semantic_weight}</span>
                  </div>
                  <Slider 
                    value={[form.rag_semantic_weight || 0.5]} 
                    min={0} max={1} step={0.1}
                    onValueChange={([v]) => setForm({...form, rag_semantic_weight: v})}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground font-mono">
                    <span>Keyword (0.0)</span>
                    <span>Semantic (1.0)</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-6 pt-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Chunk Size (Tokens)</label>
                    <Input type="number" value={form.chunk_size_tokens || 500} onChange={e => setForm({...form, chunk_size_tokens: parseInt(e.target.value)})} className="bg-background/50 h-11" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Chunk Overlap</label>
                    <Input type="number" value={form.chunk_overlap_tokens || 50} onChange={e => setForm({...form, chunk_overlap_tokens: parseInt(e.target.value)})} className="bg-background/50 h-11" />
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="sms" className="mt-0 space-y-6">
            <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50">
              <h3 className="text-xl font-display font-bold mb-6 flex items-center gap-2">
                <MessageSquare className="w-5 h-5" /> SMS Configuration
              </h3>
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-border/50">
                  <div>
                    <h4 className="font-medium text-sm">SMS Enabled</h4>
                    <p className="text-xs text-muted-foreground mt-1">Allow the assistant to send SMS messages to callers.</p>
                  </div>
                  <Switch 
                    checked={form.sms_enabled || false} 
                    onCheckedChange={(val) => setForm({...form, sms_enabled: val})} 
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Post-Call Summary Template</label>
                  <Textarea 
                    value="" 
                    placeholder={"Hi {{caller_name}}, thanks for calling {{business_name}}. Here's a summary of our conversation: {{call_summary}}"} 
                    className="h-24 bg-background/50" 
                    disabled={!form.sms_enabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Available variables: <code className="text-primary">{"{{caller_name}}"}</code>, <code className="text-primary">{"{{business_name}}"}</code>, <code className="text-primary">{"{{call_summary}}"}</code>, <code className="text-primary">{"{{call_duration}}"}</code>
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Appointment Reminder Template</label>
                  <Textarea 
                    value="" 
                    placeholder={"Reminder: You have an appointment with {{business_name}} on {{appointment_date}} at {{appointment_time}}."} 
                    className="h-24 bg-background/50" 
                    disabled={!form.sms_enabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Available variables: <code className="text-primary">{"{{business_name}}"}</code>, <code className="text-primary">{"{{appointment_date}}"}</code>, <code className="text-primary">{"{{appointment_time}}"}</code>, <code className="text-primary">{"{{caller_name}}"}</code>
                  </p>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="flags" className="mt-0 space-y-6">
            <Card className="p-6 bg-card/50 backdrop-blur-xl border-border/50">
              <h3 className="text-xl font-display font-bold mb-6">Feature Flags</h3>
              <div className="space-y-6">
                {flagsData?.flags.map(f => (
                  <div key={f.flag} className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-border/50">
                    <div>
                      <h4 className="font-mono font-bold text-sm">{f.flag}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {FLAG_DESCRIPTIONS[f.flag] || "Controls internal system behavior."}
                      </p>
                    </div>
                    <Switch checked={f.enabled} onCheckedChange={(val) => handleFlagToggle(f.flag, val)} />
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="privacy" className="mt-0 space-y-6">
            <Card className="p-6 border-destructive/20 bg-destructive/5 backdrop-blur-xl">
              <h3 className="text-xl font-display font-bold text-destructive mb-6 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> Danger Zone
              </h3>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-destructive">Data Retention (Days)</label>
                  <Input type="number" value={form.data_retention_days || 90} onChange={e => setForm({...form, data_retention_days: parseInt(e.target.value)})} className="bg-background/50 h-11 border-destructive/30 focus-visible:ring-destructive" />
                  <p className="text-xs text-destructive/80">Logs older than this will be automatically pruned.</p>
                </div>
                
                <div className="pt-6 border-t border-destructive/20">
                  <h4 className="font-bold text-foreground mb-2">GDPR Data Erasure</h4>
                  <p className="text-sm text-muted-foreground mb-4">Permanently delete all call logs, recordings, voicemails, and documents.</p>
                  <Button variant="destructive" onClick={handleDeleteData} className="shadow-lg shadow-destructive/20 font-bold">
                    Erase All Data Now
                  </Button>
                </div>
              </div>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
