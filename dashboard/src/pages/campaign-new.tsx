import { useState, useMemo, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useCreateCampaign } from "@/api-client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Rocket, Upload, FileText } from "lucide-react";
import { useDropzone } from "react-dropzone";

export default function CampaignNew() {
  const { businessId } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [phonesInput, setPhonesInput] = useState("");
  const [csvFileName, setCsvFileName] = useState<string | null>(null);

  const idempKey = useMemo(() => crypto.randomUUID(), []);
  const createCampaign = useCreateCampaign({ request: { headers: { 'Idempotency-Key': idempKey } } });

  const onDropCsv = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const numbers = text
        .split(/[\n,\r]+/)
        .map(line => line.replace(/["'\s]/g, '').trim())
        .filter(n => n.length > 0 && /^\+?\d{7,15}$/.test(n));
      setPhonesInput(numbers.join('\n'));
      toast({ title: "CSV Imported", description: `Found ${numbers.length} phone numbers from ${file.name}.` });
    };
    reader.readAsText(file);
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropCsv,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
    maxFiles: 1,
    multiple: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone_numbers = phonesInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    
    if (phone_numbers.length === 0) {
      toast({ title: "Validation Error", description: "Please enter at least one valid phone number.", variant: "destructive" });
      return;
    }

    try {
      await createCampaign.mutateAsync({
        businessId: businessId!,
        data: { name, script, phone_numbers }
      });
      toast({ title: "Campaign Launched", description: `Queued ${phone_numbers.length} calls successfully.` });
      setLocation("/campaigns");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to create", description: message, variant: "destructive" });
    }
  };

  const phoneCount = phonesInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Link href="/campaigns" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Campaigns
      </Link>

      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">New Campaign</h1>
        <p className="text-muted-foreground mt-1">Configure your outbound call batch.</p>
      </div>

      <Card className="p-8 border-border/50 bg-card/50 backdrop-blur-xl shadow-xl shadow-black/5">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Campaign Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} required placeholder="Q3 Sales Outreach" className="h-12 bg-background/50" />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">AI Script / Prompt Focus</label>
            <Textarea 
              value={script} 
              onChange={e => setScript(e.target.value)} 
              required 
              placeholder="Your objective is to qualify the lead and ask if they are interested in upgrading..." 
              className="h-32 bg-background/50 resize-none" 
            />
            <p className="text-xs text-muted-foreground">Overrides the base persona for this specific campaign.</p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Contact List (Phone Numbers)</label>
            
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/50'}`}
            >
              <input {...getInputProps()} />
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              {csvFileName ? (
                <p className="text-sm text-foreground flex items-center justify-center gap-2">
                  <FileText className="w-4 h-4" /> {csvFileName}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Drop a CSV file here, or click to select
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">CSV or TXT with one phone number per line</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-border/50" />
              <span className="text-xs text-muted-foreground">or paste manually</span>
              <div className="flex-1 border-t border-border/50" />
            </div>

            <Textarea 
              value={phonesInput} 
              onChange={e => setPhonesInput(e.target.value)} 
              placeholder={"+15551112222\n+15553334444"} 
              className="h-36 font-mono text-sm bg-background/50 resize-none" 
            />
            <p className="text-xs text-muted-foreground">
              {phoneCount > 0 ? `${phoneCount} phone number${phoneCount !== 1 ? 's' : ''} ready` : 'Paste numbers separated by commas or newlines. Must include country code (e.g. +1).'}
            </p>
          </div>

          <Button type="submit" disabled={createCampaign.isPending || phoneCount === 0} className="w-full h-12 text-base font-bold shadow-lg shadow-primary/25">
            {createCampaign.isPending ? "Queuing Calls..." : <><Rocket className="w-5 h-5 mr-2" /> Launch Campaign ({phoneCount} contacts)</>}
          </Button>
        </form>
      </Card>
    </div>
  );
}
