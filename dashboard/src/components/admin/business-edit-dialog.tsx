import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Business } from "@/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Save, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface BusinessEditDialogProps {
  business: Business;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FormData = Record<string, unknown>;

export function BusinessEditDialog({
  business,
  open,
  onOpenChange,
}: BusinessEditDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormData>({});
  const [businessHoursText, setBusinessHoursText] = useState("");
  const [businessHoursError, setBusinessHoursError] = useState("");

  useEffect(() => {
    if (business) {
      const { id, owner_id, created_at, ...editable } = business;
      setForm(editable as FormData);
      setBusinessHoursText(
        editable.business_hours
          ? JSON.stringify(editable.business_hours, null, 2)
          : ""
      );
      setBusinessHoursError("");
    }
  }, [business]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await fetch(`/api/admin/businesses/${business.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || err.message || "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "businesses"] });
      toast({
        title: "Business Updated",
        description: `${form.name || business.name} has been updated successfully.`,
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Update Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const setField = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const patchable = { ...form };

    if (businessHoursText.trim()) {
      try {
        patchable.business_hours = JSON.parse(businessHoursText);
        setBusinessHoursError("");
      } catch {
        setBusinessHoursError("Invalid JSON. Please fix before saving.");
        toast({
          title: "Validation Error",
          description: "Business hours contains invalid JSON.",
          variant: "destructive",
        });
        return;
      }
    } else {
      patchable.business_hours = null;
    }

    updateMutation.mutate(patchable);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-xl font-display">
            Edit Business — {business.name}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="w-full grid grid-cols-4 mb-4">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="greeting">Greeting & Persona</TabsTrigger>
              <TabsTrigger value="hours">Hours & Routing</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 pb-4">
              <FieldGroup label="Business Name">
                <Input
                  value={(form.name as string) || ""}
                  onChange={(e) => setField("name", e.target.value)}
                />
              </FieldGroup>
              <FieldGroup label="DID (Phone Number)">
                <Input
                  value={(form.did as string) || ""}
                  onChange={(e) => setField("did", e.target.value)}
                />
              </FieldGroup>
              <FieldGroup label="Timezone">
                <Input
                  value={(form.timezone as string) || ""}
                  onChange={(e) => setField("timezone", e.target.value)}
                />
              </FieldGroup>
              <FieldGroup label="Voice">
                <Input
                  value={(form.voice as string) || ""}
                  onChange={(e) => setField("voice", e.target.value)}
                />
              </FieldGroup>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label className="font-medium">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Deactivating will stop all call processing.
                  </p>
                </div>
                <Switch
                  checked={(form.active as boolean) ?? true}
                  onCheckedChange={(v) => setField("active", v)}
                />
              </div>
            </TabsContent>

            <TabsContent value="greeting" className="space-y-4 pb-4">
              <FieldGroup label="Greeting">
                <Textarea
                  rows={3}
                  value={(form.greeting as string) || ""}
                  onChange={(e) => setField("greeting", e.target.value)}
                />
              </FieldGroup>
              <FieldGroup label="After-Hours Greeting">
                <Textarea
                  rows={3}
                  value={(form.after_hours_greeting as string) || ""}
                  onChange={(e) =>
                    setField("after_hours_greeting", e.target.value)
                  }
                />
              </FieldGroup>
              <FieldGroup label="Persona">
                <Textarea
                  rows={4}
                  value={(form.persona as string) || ""}
                  onChange={(e) => setField("persona", e.target.value)}
                />
              </FieldGroup>
            </TabsContent>

            <TabsContent value="hours" className="space-y-4 pb-4">
              <FieldGroup label="Transfer Number">
                <Input
                  value={(form.transfer_number as string) || ""}
                  onChange={(e) =>
                    setField("transfer_number", e.target.value || null)
                  }
                />
              </FieldGroup>
              <FieldGroup label="After-Hours Number">
                <Input
                  value={(form.after_hours_number as string) || ""}
                  onChange={(e) =>
                    setField("after_hours_number", e.target.value || null)
                  }
                />
              </FieldGroup>
              <FieldGroup label="Business Hours (JSON)">
                <Textarea
                  rows={5}
                  value={businessHoursText}
                  onChange={(e) => {
                    setBusinessHoursText(e.target.value);
                    setBusinessHoursError("");
                  }}
                  className={`font-mono text-xs ${businessHoursError ? "border-destructive" : ""}`}
                />
                {businessHoursError && (
                  <p className="text-xs text-destructive mt-1">{businessHoursError}</p>
                )}
              </FieldGroup>
              <FieldGroup label="Max Concurrent Calls">
                <Input
                  type="number"
                  value={(form.max_concurrent_calls as number) ?? 0}
                  onChange={(e) =>
                    setField("max_concurrent_calls", parseInt(e.target.value) || 0)
                  }
                />
              </FieldGroup>
              <FieldGroup label="Max Calls Per Caller / Hour">
                <Input
                  type="number"
                  value={(form.max_calls_per_caller_hour as number) ?? 0}
                  onChange={(e) =>
                    setField(
                      "max_calls_per_caller_hour",
                      parseInt(e.target.value) || 0
                    )
                  }
                />
              </FieldGroup>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-4 pb-4">
              <FieldGroup label="RAG Semantic Weight">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={(form.rag_semantic_weight as number) ?? 0.5}
                  onChange={(e) =>
                    setField(
                      "rag_semantic_weight",
                      parseFloat(e.target.value) || 0
                    )
                  }
                />
              </FieldGroup>
              <FieldGroup label="Chunk Size (tokens)">
                <Input
                  type="number"
                  value={(form.chunk_size_tokens as number) ?? 0}
                  onChange={(e) =>
                    setField("chunk_size_tokens", parseInt(e.target.value) || 0)
                  }
                />
              </FieldGroup>
              <FieldGroup label="Chunk Overlap (tokens)">
                <Input
                  type="number"
                  value={(form.chunk_overlap_tokens as number) ?? 0}
                  onChange={(e) =>
                    setField(
                      "chunk_overlap_tokens",
                      parseInt(e.target.value) || 0
                    )
                  }
                />
              </FieldGroup>
              <FieldGroup label="Data Retention (days)">
                <Input
                  type="number"
                  value={(form.data_retention_days as number) ?? 90}
                  onChange={(e) =>
                    setField(
                      "data_retention_days",
                      parseInt(e.target.value) || 0
                    )
                  }
                />
              </FieldGroup>

              <div className="space-y-3 pt-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Feature Toggles
                </h3>
                <ToggleField
                  label="Recording Enabled"
                  description="Record all inbound calls."
                  checked={(form.recording_enabled as boolean) ?? false}
                  onChange={(v) => setField("recording_enabled", v)}
                />
                <ToggleField
                  label="SMS Enabled"
                  description="Send SMS notifications to callers."
                  checked={(form.sms_enabled as boolean) ?? false}
                  onChange={(v) => setField("sms_enabled", v)}
                />
                <ToggleField
                  label="Calendar Enabled"
                  description="Enable appointment scheduling."
                  checked={(form.calendar_enabled as boolean) ?? false}
                  onChange={(v) => setField("calendar_enabled", v)}
                />
              </div>
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="shadow-lg shadow-primary/25"
          >
            {updateMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div>
        <Label className="font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
