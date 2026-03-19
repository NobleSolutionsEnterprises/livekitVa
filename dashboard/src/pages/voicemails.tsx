import { useAuth } from "@/lib/auth";
import { useListVoicemails, useUpdateVoicemail, Voicemail } from "@/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Voicemail as VoicemailIcon, Clock, CheckCircle2 } from "lucide-react";
import { getListVoicemailsQueryKey } from "@/api-client";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

export default function Voicemails() {
  const { businessId } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListVoicemails(businessId!);
  const updateVoicemail = useUpdateVoicemail();

  const handleMarkRead = async (id: string) => {
    await updateVoicemail.mutateAsync({ businessId: businessId!, voicemailId: id, data: { read: true } });
    queryClient.invalidateQueries({ queryKey: getListVoicemailsQueryKey(businessId!) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Voicemails</h1>
        <p className="text-muted-foreground mt-1">Manage and review your incoming voice messages.</p>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-xl shadow-xl shadow-black/5 p-2">
        {isLoading ? (
          <div className="p-12 flex justify-center"><div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" /></div>
        ) : !data?.items.length ? (
          <div className="text-center py-20 text-muted-foreground">
            <VoicemailIcon className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p className="text-lg">Your inbox is empty.</p>
          </div>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {data.items.map((vm: Voicemail) => (
              <AccordionItem value={vm.id} key={vm.id} className="border-border/50 px-4">
                <AccordionTrigger className="hover:no-underline py-4">
                  <div className="flex items-center gap-4 w-full pr-4">
                    <div className={`w-3 h-3 rounded-full ${vm.read ? 'bg-transparent' : 'bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.6)]'}`} />
                    <div className="flex-1 text-left">
                      <div className="font-mono font-bold text-lg">{vm.caller_number}</div>
                      <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
                        <span>{format(new Date(vm.created_at), 'PP p')}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {vm.duration_sec}s</span>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-6">
                  <div className="bg-background/50 rounded-xl p-6 border border-border/50 space-y-6">
                    <audio controls src={vm.recording_url} className="w-full h-12 outline-none" />
                    
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Transcript</h4>
                      <p className="text-sm font-mono leading-relaxed">{vm.transcript || "No transcript available."}</p>
                    </div>

                    {!vm.read && (
                      <Button onClick={() => handleMarkRead(vm.id)} variant="outline" className="w-full sm:w-auto border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground">
                        <CheckCircle2 className="w-4 h-4 mr-2" /> Mark as Read
                      </Button>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </Card>
    </div>
  );
}
