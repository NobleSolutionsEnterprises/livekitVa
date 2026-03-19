import { useRoute, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetCall, useGetCallRetrieval } from "@/api-client";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { ArrowLeft, Clock, Calendar as CalendarIcon, Phone, BrainCircuit, FileText } from "lucide-react";
import { OUTCOME_COLORS } from "./calls";

export default function CallDetail() {
  const [, params] = useRoute("/calls/:id");
  const callId = params?.id;
  const { businessId } = useAuth();

  const callQueryKey = ["getCall", businessId, callId] as const;
  const ragQueryKey = ["getCallRetrieval", businessId, callId] as const;

  const { data: call, isLoading: loadingCall } = useGetCall(businessId!, callId || "", {
    query: { enabled: !!(businessId && callId), queryKey: callQueryKey }
  });

  const { data: rag } = useGetCallRetrieval(businessId!, callId || "", {
    query: { enabled: !!(businessId && callId), queryKey: ragQueryKey }
  });

  if (loadingCall) {
    return <div className="p-12 flex justify-center"><div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!call) return <div className="text-center p-12 text-destructive">Call not found</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Link href="/calls" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Calls
      </Link>

      <Card className="p-6 md:p-8 bg-card/50 backdrop-blur-xl border-border/50 shadow-xl shadow-black/5">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 pb-8 border-b border-border/50">
          <div className="flex items-center gap-4">
            <div className={`p-4 rounded-2xl ${call.direction === 'inbound' ? 'bg-blue-500/10 text-blue-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
              <Phone className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-3xl font-display font-bold font-mono tracking-tight">{call.caller_number}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><CalendarIcon className="w-4 h-4"/> {format(new Date(call.started_at), 'PPP')}</span>
                <span className="flex items-center gap-1"><Clock className="w-4 h-4"/> {format(new Date(call.started_at), 'p')}</span>
                {call.duration_sec && <span>• {Math.floor(call.duration_sec / 60)}m {call.duration_sec % 60}s</span>}
              </div>
            </div>
          </div>
          {call.outcome && (
            <Badge className={`px-4 py-1.5 text-sm uppercase tracking-wider font-bold border ${OUTCOME_COLORS[call.outcome]}`}>
              {call.outcome.replace('_', ' ')}
            </Badge>
          )}
        </div>

        {call.recording_url && (
          <div className="mb-8 p-6 bg-background/50 rounded-2xl border border-border/50">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Call Recording</h3>
            <audio controls src={call.recording_url} className="w-full h-12 outline-none" />
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-display font-bold mb-4">
                <FileText className="w-5 h-5 text-primary" /> Transcript
              </h3>
              <div className="bg-background/50 p-6 rounded-2xl border border-border/50 h-[500px] overflow-y-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground/80 shadow-inner">
                {call.transcript || "No transcript generated for this call."}
              </div>
            </div>
            {call.summary && (
              <div className="bg-primary/5 border border-primary/20 p-6 rounded-2xl">
                <h3 className="font-bold text-primary mb-2">AI Summary</h3>
                <p className="text-sm text-foreground/80 leading-relaxed">{call.summary}</p>
              </div>
            )}
          </div>

          <div>
            <h3 className="flex items-center gap-2 text-lg font-display font-bold mb-4">
              <BrainCircuit className="w-5 h-5 text-accent" /> RAG Retrieval Trace
            </h3>
            <div className="bg-background/50 p-4 rounded-2xl border border-border/50 h-[500px] overflow-y-auto">
              {!rag || rag.turns.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">No knowledge retrieval used in this call.</div>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {rag.turns.map((turn) => (
                    <AccordionItem value={`turn-${turn.turn_index}`} key={turn.turn_index} className="border-border/50">
                      <AccordionTrigger className="hover:no-underline hover:bg-muted/30 px-4 rounded-lg transition-colors text-left">
                        <div>
                          <span className="text-xs text-muted-foreground font-mono block mb-1">Turn {turn.turn_index}</span>
                          <span className="font-medium">"{turn.utterance}"</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4 pt-2">
                        <div className="space-y-3">
                          {turn.chunks.map((chunk, idx) => (
                            <div key={chunk.id} className="bg-card p-4 rounded-xl border border-border shadow-sm">
                              <div className="flex justify-between items-center mb-2">
                                <Badge variant="secondary" className="text-xs font-mono">Chunk {idx + 1}</Badge>
                                <span className="text-xs text-muted-foreground font-mono">RRF Score: {chunk.scores.rrf.toFixed(3)}</span>
                              </div>
                              <p className="text-sm text-foreground/80 leading-relaxed">{chunk.content}</p>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
